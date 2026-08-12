import { Injectable, Logger } from '@nestjs/common';
import {
  CandidateCluster,
  ClusterClassification,
  ClusterOccurrence,
} from '../../models/credit-detection.model';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { IncomingSuggestion } from '../../models/loan-suggestion.model';
import { escapeRegex } from '../../common/regex.util';

const MIN_CONFIDENCE = 0.6;
const AMOUNT_TOLERANCE = 0.05;
const INTERVAL_MULTI_MIN_DAYS = 25;
const INTERVAL_MULTI_MAX_DAYS = 35;
const INTERVAL_SINGLE_MIN_DAYS = 20;
const INTERVAL_SINGLE_MAX_DAYS = 40;

export interface ValidationResult {
  created: boolean;
  reason?: string;
}

/**
 * Validateur déterministe des clusters classifiés par CreditClassifierService.
 * Aucun appel LLM ici — que des règles chiffrées (spec §3) qui protègent
 * contre les faux positifs installment avant de matérialiser une suggestion.
 */
@Injectable()
export class DetectionValidatorService {
  private readonly logger = new Logger(DetectionValidatorService.name);

  constructor(
    private readonly loansService: LoansService,
    private readonly loanSuggestionsService: LoanSuggestionsService,
  ) {}

  async validate(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): Promise<ValidationResult> {
    if (classification.confidence < MIN_CONFIDENCE) {
      return { created: false, reason: 'low_confidence' };
    }

    switch (classification.classification) {
      case 'not_credit':
        return { created: false, reason: 'not_credit' };
      case 'installment':
        return this.validateInstallment(cluster, classification);
      case 'subscription':
        return this.createSuggestion(cluster, classification, 'subscription');
      case 'revolving':
      case 'classic':
        return this.validateStandardLoan(cluster, classification);
      default:
        return { created: false, reason: 'unknown_classification' };
    }
  }

  private async validateInstallment(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;
    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.median(amountsAbs);

    const outOfRange = amountsAbs.some(
      (a) => Math.abs(a - medianAmount) > medianAmount * AMOUNT_TOLERANCE,
    );
    if (outOfRange) {
      return { created: false, reason: 'installment_amount_variance' };
    }

    const months = occurrences.map((o) => o.date.slice(0, 7));
    if (new Set(months).size !== months.length) {
      return { created: false, reason: 'installment_multiple_per_month' };
    }

    const intervalCheck = DetectionValidatorService.checkIntervals(occurrences);
    if (!intervalCheck) {
      return { created: false, reason: 'installment_interval_out_of_range' };
    }

    if (
      classification.installmentCount != null &&
      occurrences.length > classification.installmentCount
    ) {
      return { created: false, reason: 'installment_count_exceeded' };
    }

    const match = await this.loansService.findExistingLoan({
      creditor: classification.creditor,
      monthlyAmount: DetectionValidatorService.round2(medianAmount),
      description: occurrences[occurrences.length - 1].description,
    });
    if (
      match &&
      (match.confidence === 'high' || match.confidence === 'medium')
    ) {
      return { created: false, reason: 'existing_loan_match' };
    }

    const count = classification.installmentCount ?? occurrences.length;
    const label = DetectionValidatorService.buildLabel(
      classification,
      `${count}×`,
    );

    const incoming: IncomingSuggestion = {
      label,
      monthlyAmount: DetectionValidatorService.round2(medianAmount),
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType: 'loan',
      matchPattern: escapeRegex(classification.creditor),
      creditor: classification.creditor,
      installment: {
        count: classification.installmentCount,
        merchant: classification.merchant,
        occurrenceTxIds: occurrences.map((o) => o.transactionId),
        amounts: amountsAbs,
        dates: occurrences.map((o) => o.date),
      },
      source: 'llm_detection',
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  private async validateStandardLoan(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;
    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    const match = await this.loansService.findExistingLoan({
      creditor: classification.creditor,
      monthlyAmount: medianAmount,
      description: occurrences[occurrences.length - 1].description,
    });
    if (
      match &&
      (match.confidence === 'high' || match.confidence === 'medium')
    ) {
      return { created: false, reason: 'existing_loan_match' };
    }

    return this.createSuggestion(cluster, classification, 'loan');
  }

  private async createSuggestion(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    suggestedType: 'loan' | 'subscription',
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;
    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    const incoming: IncomingSuggestion = {
      label: DetectionValidatorService.buildLabel(classification),
      monthlyAmount: medianAmount,
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType,
      matchPattern: escapeRegex(classification.creditor),
      creditor: classification.creditor,
      source: 'llm_detection',
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  private static buildLabel(
    classification: ClusterClassification,
    prefix?: string,
  ): string {
    const base = prefix
      ? `${prefix} ${classification.creditor}`
      : classification.creditor;
    return classification.merchant
      ? `${base} · ${classification.merchant}`
      : base;
  }

  /**
   * true si l'espacement entre occurrences consécutives est cohérent avec
   * un rythme mensuel : médiane des intervalles dans [25,35]j si ≥2
   * intervalles, ou l'unique intervalle dans [20,40]j s'il n'y en a qu'un.
   * Une seule occurrence (0 intervalle) ne peut pas être invalidée ici.
   */
  private static checkIntervals(occurrences: ClusterOccurrence[]): boolean {
    if (occurrences.length < 2) return true;
    const intervals: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      intervals.push(
        DetectionValidatorService.daysBetween(
          occurrences[i - 1].date,
          occurrences[i].date,
        ),
      );
    }
    if (intervals.length === 1) {
      return (
        intervals[0] >= INTERVAL_SINGLE_MIN_DAYS &&
        intervals[0] <= INTERVAL_SINGLE_MAX_DAYS
      );
    }
    const medianInterval = DetectionValidatorService.median(intervals);
    return (
      medianInterval >= INTERVAL_MULTI_MIN_DAYS &&
      medianInterval <= INTERVAL_MULTI_MAX_DAYS
    );
  }

  private static daysBetween(from: string, to: string): number {
    return Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
    );
  }

  private static median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }

  private static round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
