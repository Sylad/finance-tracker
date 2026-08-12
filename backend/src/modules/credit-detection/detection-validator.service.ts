import { Injectable, Logger } from '@nestjs/common';
import {
  CandidateCluster,
  ClusterClassification,
  ClusterOccurrence,
} from '../../models/credit-detection.model';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import {
  IncomingSuggestion,
  SuggestionEvidence,
} from '../../models/loan-suggestion.model';
import { escapeRegex } from '../../common/regex.util';

const MIN_CONFIDENCE = 0.6;
const AMOUNT_TOLERANCE = 0.05;
const INTERVAL_MULTI_MIN_DAYS = 25;
const INTERVAL_MULTI_MAX_DAYS = 35;
const INTERVAL_SINGLE_MIN_DAYS = 20;
const INTERVAL_SINGLE_MAX_DAYS = 40;
/** Round 5 fix 3 : au-delà de ce nombre de jours entre la dernière
 *  occurrence d'un cluster et la date la plus récente observée sur tous
 *  les relevés, la série est considérée terminée — pas de suggestion. */
const SERIES_ENDED_MAX_DAYS = 60;
/** Round 5 fix 1 : nombre max d'occurrences persistées dans `evidence`. */
const MAX_EVIDENCE_OCCURRENCES = 12;
/** Round 3 fix 1 : une sous-série installment avec ≥6 occurrences (donc
 *  ≥6 mois calendaires distincts, déjà garanti par le check mensuel) à
 *  montant stable (garanti par splitByAmount) n'est pas un paiement en N
 *  fois — c'est un abonnement récurrent que le LLM a mal classé
 *  `installment` (ex. Prime Video 1.99/mois). */
const LONG_SERIES_SUBSCRIPTION_MIN_OCCURRENCES = 6;
/** Round 6 fix : nombre minimum de mois calendaires distincts pour que la
 *  branche standard-loan (revolving/classic) affirme une récurrence
 *  mensuelle suffisante pour un crédit — cf CLAUDE.md invariant "1 débit/
 *  mois max par crédit" (APEX 06). En dessous, pas assez de signal. */
const MIN_LOAN_DISTINCT_MONTHS = 3;
/** Round 6 fix : un crédit se débite le même jour du mois (± quelques
 *  jours pour les décalages week-ends/fériés) — au-delà de cet écart
 *  (distance circulaire, gère la fin de mois) par rapport à la médiane
 *  des jours-du-mois observés, la série n'a pas le profil d'un crédit. */
const MAX_DAY_OF_MONTH_DRIFT = 5;

export interface ValidationResult {
  created: boolean;
  /** Nombre de suggestions effectivement créées (branche installment
   *  multi-sous-séries). Absent quand non pertinent (0 ou 1 implicite). */
  createdCount?: number;
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
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    if (classification.confidence < MIN_CONFIDENCE) {
      return { created: false, reason: 'low_confidence' };
    }

    // Round 5 fix 3 : garde de fraîcheur, AVANT la classification par type —
    // une série dont la dernière occurrence est trop ancienne par rapport
    // au relevé le plus récent est terminée, peu importe sa classification.
    const lastOccurrenceDate = DetectionValidatorService.maxDate(
      cluster.occurrences.map((o) => o.date),
    );
    if (
      DetectionValidatorService.daysBetween(
        lastOccurrenceDate,
        latestStatementDate,
      ) > SERIES_ENDED_MAX_DAYS
    ) {
      return { created: false, reason: 'series_ended' };
    }

    switch (classification.classification) {
      case 'not_credit':
        return { created: false, reason: 'not_credit' };
      case 'installment':
        return this.validateInstallment(
          cluster,
          classification,
          latestStatementDate,
        );
      case 'subscription':
        return this.createSuggestion(cluster, classification, 'subscription');
      case 'revolving':
      case 'classic':
        return this.validateStandardLoan(cluster, classification);
      default:
        return { created: false, reason: 'unknown_classification' };
    }
  }

  /**
   * Un cluster creditor|merchant peut contenir plusieurs plans N× joués en
   * parallèle (montants différents, ex. Klarna qui enchaîne 3 achats
   * distincts chez le même marchand). On découpe donc d'abord en
   * sous-séries par montant (clustering glouton ±5%, cf. `splitByAmount`
   * de LoansService) puis chaque sous-série ≥2 occurrences est validée
   * indépendamment et produit sa propre suggestion. Une sous-série isolée
   * (1 occurrence) est silencieusement ignorée sans invalider les autres.
   *
   * Round 7 fix 1 : le garde de fraîcheur cluster-niveau de `validate()`
   * ne teste que la date max de TOUT le cluster — un cluster creditor
   * (ex. 'carrefour') dont une sous-série est vivante laissait passer ses
   * sous-séries mortes (montant différent, plus revu depuis des mois).
   * `latestStatementDate` est donc propagé jusqu'à
   * `validateInstallmentSubSeries` qui applique le même garde par
   * sous-série — une sous-série morte est rejetée `series_ended` sans
   * invalider les autres (même logique que les autres rejets ici : la
   * boucle continue, `lastReason` est mis à jour).
   */
  private async validateInstallment(
    cluster: CandidateCluster,
    classification: ClusterClassification,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    const subSeries = DetectionValidatorService.splitByAmount(
      cluster.occurrences,
    ).filter((occurrences) => occurrences.length >= 2);

    if (subSeries.length === 0) {
      return { created: false, reason: 'installment_no_recurring_amount' };
    }

    const disambiguate = subSeries.length > 1;
    let createdCount = 0;
    let lastReason: string | undefined;

    for (const occurrences of subSeries) {
      const result = await this.validateInstallmentSubSeries(
        occurrences,
        classification,
        disambiguate,
        latestStatementDate,
      );
      if (result.created) {
        createdCount++;
      } else {
        lastReason = result.reason;
      }
    }

    if (createdCount === 0) {
      return {
        created: false,
        reason: lastReason ?? 'installment_no_recurring_amount',
      };
    }
    return { created: true, createdCount };
  }

  private async validateInstallmentSubSeries(
    occurrences: ClusterOccurrence[],
    classification: ClusterClassification,
    disambiguate: boolean,
    latestStatementDate: string,
  ): Promise<ValidationResult> {
    // Round 7 fix 1 : garde de fraîcheur PAR sous-série (le check
    // cluster-niveau de `validate()` reste en early-exit économe, mais ne
    // suffit pas dès qu'une sous-série vivante masque des sous-séries
    // mortes du même cluster).
    const subSeriesLastDate = DetectionValidatorService.maxDate(
      occurrences.map((o) => o.date),
    );
    if (
      DetectionValidatorService.daysBetween(
        subSeriesLastDate,
        latestStatementDate,
      ) > SERIES_ENDED_MAX_DAYS
    ) {
      return { created: false, reason: 'series_ended' };
    }

    const months = occurrences.map((o) => o.date.slice(0, 7));
    if (new Set(months).size !== months.length) {
      return { created: false, reason: 'installment_multiple_per_month' };
    }

    const intervalCheck = DetectionValidatorService.checkIntervals(occurrences);
    if (!intervalCheck) {
      return { created: false, reason: 'installment_interval_out_of_range' };
    }

    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    // Round 3 fix 2 : vérifié AVANT toute autre décision (reroute
    // subscription incluse) — si c'est un crédit déjà suivi, on ne veut
    // jamais le re-suggérer, peu importe sous quelle forme.
    if (
      await this.hasFuzzyKnownLoanPayment(
        classification.creditor,
        medianAmount,
      )
    ) {
      return { created: false, reason: 'existing_loan_payment' };
    }

    // Round 3 fix 1 — reroute AVANT le check installmentCount : le
    // installmentCount du LLM n'est pas pertinent pour juger une série
    // qu'il a de toute façon mal classée.
    if (occurrences.length >= LONG_SERIES_SUBSCRIPTION_MIN_OCCURRENCES) {
      return this.createSubscriptionFromLongSeries(
        occurrences,
        classification,
        medianAmount,
        disambiguate,
      );
    }

    if (
      classification.installmentCount != null &&
      occurrences.length > classification.installmentCount
    ) {
      return { created: false, reason: 'installment_count_exceeded' };
    }

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

    const count = classification.installmentCount ?? occurrences.length;
    const base = DetectionValidatorService.buildLabel(
      classification,
      `${count}×`,
    );
    const label = disambiguate ? `${base} (${medianAmount}€)` : base;

    const incoming: IncomingSuggestion = {
      label,
      monthlyAmount: medianAmount,
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
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  /**
   * Round 3 fix 1 : route une sous-série longue (≥6 occurrences, montant
   * stable par construction de `splitByAmount`) vers une suggestion
   * `subscription` plutôt qu'`installment` — sans champ `installment`
   * (ce n'est pas un plan N×), label désambiguïsé par montant seulement
   * si le cluster porte plusieurs sous-séries.
   */
  private async createSubscriptionFromLongSeries(
    occurrences: ClusterOccurrence[],
    classification: ClusterClassification,
    medianAmount: number,
    disambiguate: boolean,
  ): Promise<ValidationResult> {
    const base = DetectionValidatorService.buildLabel(classification);
    const label = disambiguate ? `${base} (${medianAmount}€)` : base;

    const incoming: IncomingSuggestion = {
      label,
      monthlyAmount: medianAmount,
      occurrencesSeen: occurrences.length,
      firstSeenDate: occurrences[0].date,
      suggestedType: 'subscription',
      matchPattern: escapeRegex(classification.creditor),
      creditor: classification.creditor,
      source: 'llm_detection',
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
    };

    await this.loanSuggestionsService.upsertMany(
      occurrences[occurrences.length - 1].statementId,
      [incoming],
    );
    return { created: true };
  }

  /**
   * Round 3 fix 2 : garde créancier existant fuzzy, vérifiée AVANT
   * `findExistingLoan` (qui exige un match exact/heuristique sur
   * creditor+matchPattern). `findExistingLoan` ratait des crédits réels
   * quand le creditor extrait par le LLM du cluster ('carrefour') diverge
   * du creditor stocké sur le Loan ('CARREFOUR BANQUE'). Normalise
   * (lowercase, trim) et matche par containment dans les deux sens, et
   * exige un montant proche (±5%) du `monthlyPayment` du loan pour éviter
   * de bloquer un cluster sans rapport chez le même créancier (ex.
   * Carrefour Market vs Carrefour Banque).
   *
   * Round 5 fix 2 : matche TOUS les loans, actifs ET inactifs (renommé en
   * conséquence — ex-`hasFuzzyActiveLoanPayment`). Un crédit tracké puis
   * clôturé (ex. LBP Consumer Finance) ne doit jamais être re-suggéré : le
   * fait qu'il soit `isActive:false` ne le rend pas invisible pour ce
   * garde, seulement pour le reste de l'app.
   */
  private async hasFuzzyKnownLoanPayment(
    creditor: string,
    medianAmount: number,
  ): Promise<boolean> {
    const normalizedCluster = creditor.toLowerCase().trim();
    if (!normalizedCluster) return false;
    const loans = await this.loansService.getAll();
    return loans.some((loan) => {
      if (!loan.creditor) return false;
      const normalizedLoan = loan.creditor.toLowerCase().trim();
      if (!normalizedLoan) return false;
      const contains =
        normalizedLoan.includes(normalizedCluster) ||
        normalizedCluster.includes(normalizedLoan);
      if (!contains) return false;
      const tolerance = loan.monthlyPayment * AMOUNT_TOLERANCE;
      return Math.abs(medianAmount - loan.monthlyPayment) <= tolerance;
    });
  }

  /**
   * Regroupe les occurrences en sous-séries par montant : clustering
   * glouton sur les montants triés, deux occurrences dans la même
   * sous-série si leurs montants absolus sont à ±5 % l'un de l'autre
   * (tolérance mesurée contre la moyenne courante du bucket, comme
   * `LoansService.splitByAmount`). Chaque bucket est ensuite re-trié par
   * date croissante (ordre attendu par `checkIntervals`).
   */
  private static splitByAmount(
    occurrences: ClusterOccurrence[],
  ): ClusterOccurrence[][] {
    const sorted = [...occurrences].sort(
      (a, b) => Math.abs(a.amount) - Math.abs(b.amount),
    );
    const buckets: ClusterOccurrence[][] = [];
    for (const o of sorted) {
      const amt = Math.abs(o.amount);
      const last = buckets[buckets.length - 1];
      const lastAvg = last
        ? last.reduce((s, x) => s + Math.abs(x.amount), 0) / last.length
        : 0;
      const tolerance = lastAvg * AMOUNT_TOLERANCE;
      if (last && Math.abs(amt - lastAvg) <= tolerance) {
        last.push(o);
      } else {
        buckets.push([o]);
      }
    }
    return buckets.map((bucket) =>
      [...bucket].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      ),
    );
  }

  /**
   * Round 6 fix : la branche standard-loan (revolving/classic) ne
   * vérifiait pas l'invariant métier "1 débit/mois max par crédit"
   * (cf CLAUDE.md APEX 06) ni la stabilité du jour de prélèvement — un
   * cluster à plusieurs occurrences/mois et montants variables (38 occ
   * sur 10 mois observées en prod) pouvait être suggéré comme crédit.
   * Trois checks structurels, APRÈS le garde fraîcheur de `validate()` et
   * AVANT tout appel à `loansService` :
   *  1. ≤1 occurrence par mois calendaire (un crédit ne se débite jamais
   *     2× le même mois) -> `loan_multiple_per_month`.
   *  2. ≥MIN_LOAN_DISTINCT_MONTHS mois calendaires distincts (sinon pas
   *     assez de récurrence pour affirmer un crédit — les N× courts
   *     restent gérés par la branche installment, non touchée ici) ->
   *     `loan_insufficient_recurrence`.
   *  3. Jour du mois stable : un crédit tombe le même jour à quelques
   *     jours près (décalages week-ends/fériés). Écart à la médiane des
   *     jours-du-mois, en distance circulaire (gère la fin de mois,
   *     ex. 28 vs 2) -> `loan_irregular_day` si un écart dépasse
   *     MAX_DAY_OF_MONTH_DRIFT.
   */
  private async validateStandardLoan(
    cluster: CandidateCluster,
    classification: ClusterClassification,
  ): Promise<ValidationResult> {
    const occurrences = cluster.occurrences;

    const months = occurrences.map((o) => o.date.slice(0, 7));
    const distinctMonths = new Set(months);
    if (distinctMonths.size !== months.length) {
      return { created: false, reason: 'loan_multiple_per_month' };
    }
    if (distinctMonths.size < MIN_LOAN_DISTINCT_MONTHS) {
      return { created: false, reason: 'loan_insufficient_recurrence' };
    }

    const daysOfMonth = occurrences.map((o) => Number(o.date.slice(8, 10)));
    const medianDay = DetectionValidatorService.median(daysOfMonth);
    const hasIrregularDay = daysOfMonth.some((d) => {
      const diff = Math.abs(d - medianDay);
      return Math.min(diff, 31 - diff) > MAX_DAY_OF_MONTH_DRIFT;
    });
    if (hasIrregularDay) {
      return { created: false, reason: 'loan_irregular_day' };
    }

    const amountsAbs = occurrences.map((o) => Math.abs(o.amount));
    const medianAmount = DetectionValidatorService.round2(
      DetectionValidatorService.median(amountsAbs),
    );

    if (
      await this.hasFuzzyKnownLoanPayment(
        classification.creditor,
        medianAmount,
      )
    ) {
      return { created: false, reason: 'existing_loan_payment' };
    }

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
      evidence: DetectionValidatorService.buildEvidence(
        occurrences,
        classification.rationale,
      ),
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

  private static maxDate(dates: string[]): string {
    return dates.reduce((max, d) => (d > max ? d : max), dates[0]);
  }

  /**
   * Round 5 fix 1 : preuves persistées derrière une suggestion — occurrences
   * plafonnées aux MAX_EVIDENCE_OCCURRENCES plus récentes, rationale de la
   * ClusterClassification, lastSeenDate = dernière occurrence observée.
   * Appelée depuis les 3 points de création de suggestion (installment,
   * subscription reroutée depuis une série longue, loan/subscription
   * standard) pour que TOUTE suggestion issue de la détection en porte une.
   */
  private static buildEvidence(
    occurrences: ClusterOccurrence[],
    rationale: string,
  ): SuggestionEvidence {
    const sorted = [...occurrences].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const capped = sorted.slice(-MAX_EVIDENCE_OCCURRENCES);
    return {
      occurrences: capped.map((o) => ({
        date: o.date,
        amount: Math.abs(o.amount),
        description: o.description,
      })),
      rationale,
      lastSeenDate: sorted[sorted.length - 1].date,
    };
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
