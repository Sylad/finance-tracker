import { Injectable, Logger } from '@nestjs/common';
import { LoansService } from './loans.service';
import type { MatchSignals, MatchResult, AmortizationSnapshotInput } from './loans.service';
import type { CreditStatementAnalysis } from '../analysis/credit-statement.service';
import { StorageService } from '../storage/storage.service';
import type { LoanInput, Loan, InstallmentLine } from '../../models/loan.model';

/**
 * Defaults pour la création d'un Loan quand aucun match n'est trouvé.
 * Tous les champs sont optionnels mais `name`, `type`, `category`,
 * `monthlyPayment`, `matchPattern`, `isActive` doivent être présents
 * (requis par `LoanInput`).
 */
export type LoanDefaults = Partial<LoanInput> & Pick<LoanInput, 'name' | 'type' | 'category' | 'monthlyPayment' | 'matchPattern' | 'isActive'> & {
  installmentSchedule?: InstallmentLine[];
  installmentMerchant?: string;
  installmentSignatureDate?: string;
};

/**
 * IMPORT ORCHESTRATOR — point d'entrée unique pour les 3 paths d'import :
 *
 *   1. importCreditStatement(extracted)         (PDF relevé crédit)
 *   2. importAmortization(extracted, attachId?) (PDF tableau d'amortissement)
 *   3. attachOrCreate(signals, defaults, src)   (suggestions Claude bank)
 *
 * Chaque path commence par `findExistingLoan(signals)` (matcher unifié) avant
 * de décider create vs update. Centralise la logique find-or-create pour
 * éviter les doublons quand un même crédit est importé via plusieurs sources.
 */
@Injectable()
export class ImportOrchestratorService {
  private readonly logger = new Logger(ImportOrchestratorService.name);

  constructor(
    private readonly loans: LoansService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Find-or-create générique. Utilisé par tous les paths qui ont besoin
   * d'identifier un loan ou d'en créer un nouveau.
   */
  async findOrCreate(
    signals: MatchSignals,
    defaults: LoanDefaults,
  ): Promise<{ loan: Loan; created: boolean; matchConfidence?: MatchResult['confidence']; matchReason?: string }> {
    const match = await this.loans.findExistingLoan(signals);
    if (match) {
      this.logger.log(`findOrCreate: matched loan ${match.loan.id} (confidence=${match.confidence}, reason=${match.reason})`);
      return { loan: match.loan, created: false, matchConfidence: match.confidence, matchReason: match.reason };
    }
    this.logger.log(`findOrCreate: no match for signals → creating new loan "${defaults.name}"`);
    const loan = await this.loans.create(defaults);
    return { loan, created: true };
  }

  /**
   * Import d'un relevé/contrat de crédit. 2 chemins selon le PDF :
   *
   *   A) `extracted.installmentDetails != null` → CONTRAT pay-in-N (4XCB
   *      Cofidis, 3X Alma, FacilyPay…). On crée un Loan `kind='installment'`
   *      avec `installmentSchedule[]` exact, prêt à être matché par
   *      `auto-sync.syncLoans` lors des prochains imports bank.
   *
   *   B) Sinon → relevé mensuel classique (revolving Cofidis ou amortissable).
   *      Trouve l'existant via identifiants OU crée + applique le snapshot
   *      canonique.
   */
  async importCreditStatement(extracted: CreditStatementAnalysis): Promise<{ loan: Loan; created: boolean; matchConfidence?: MatchResult['confidence']; matchReason?: string }> {
    if (extracted.installmentDetails) {
      return this.importInstallmentContract(extracted);
    }
    return this.importStandardCreditStatement(extracted);
  }

  /**
   * Branche A : contrat pay-in-N (kind='installment').
   */
  private async importInstallmentContract(
    extracted: CreditStatementAnalysis,
  ): Promise<{ loan: Loan; created: boolean; matchConfidence?: MatchResult['confidence']; matchReason?: string }> {
    const details = extracted.installmentDetails!;
    const signals: MatchSignals = {
      // Pour un installment Cofidis, contractRef est rare ; on s'appuie sur
      // creditor + totalAmount pour matcher les imports doublons.
      creditor: extracted.creditor,
      monthlyAmount: details.amount,
    };
    const merchantSuffix = details.merchant ? ` · ${details.merchant}` : '';
    const baseName = `${details.count}× ${extracted.creditor}${merchantSuffix} (${details.totalAmount.toFixed(0)}€)`;
    const installmentSchedule: InstallmentLine[] = details.installments
      .map((i) => ({ dueDate: i.date, amount: i.amount, paid: false }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const lastDueDate = installmentSchedule[installmentSchedule.length - 1].dueDate;
    const defaults: LoanDefaults = {
      name: baseName,
      type: 'classic', // historique : 'classic' fait sens pour un installment court
      kind: 'installment',
      category: 'consumer',
      monthlyPayment: details.amount,
      matchPattern: extracted.creditor,
      isActive: true,
      creditor: extracted.creditor,
      startDate: details.signatureDate ?? installmentSchedule[0].dueDate,
      endDate: lastDueDate,
      installmentSchedule,
      installmentMerchant: details.merchant ?? undefined,
      installmentSignatureDate: details.signatureDate ?? undefined,
    };
    const result = await this.findOrCreate(signals, defaults);
    // Retro-match : à l'import du contrat, marquer paid les past dueDates
    // dont on retrouve la trace dans les relevés bancaires existants. Sans
    // ce retro-match, le card affiche "0/4 · TROU" alors que les débits ont
    // déjà eu lieu — l'invariant 1 débit/mois nous donne 1 candidat unique
    // par échéance.
    if (result.created) {
      await this.retroMatchInstallment(result.loan);
    }
    return result;
  }

  /**
   * Pour un Loan installment fraîchement créé : parcourt tous les relevés
   * bancaires stockés, cherche les transactions matchant chaque past dueDate
   * (date ±3j, amount ±0.50€, description contient creditor), et marque
   * paid via `markInstallmentPaid`. Idempotent — sans effet si le matcher
   * ne trouve rien (pas de relevé bancaire couvrant la période).
   */
  private async retroMatchInstallment(loan: Loan): Promise<void> {
    const schedule = loan.installmentSchedule;
    if (!schedule || schedule.length === 0) return;
    const creditorLower = (loan.creditor ?? '').toLowerCase().trim();
    if (!creditorLower) return;

    const today = new Date().toISOString().slice(0, 10);
    const allStatements = await this.storage.getAllStatements();
    let marked = 0;
    for (let i = 0; i < schedule.length; i++) {
      const line = schedule[i];
      if (line.paid) continue;
      if (line.dueDate > today) continue; // future, pas de débit attendu

      const dueMs = new Date(line.dueDate + 'T00:00:00Z').getTime();
      const tolMs = 3 * 24 * 3600 * 1000;
      let matched: { tx: { id: string; date: string; amount: number; description: string }; statementId: string } | null = null;
      for (const stmt of allStatements) {
        for (const t of stmt.transactions) {
          if (!t.description.toLowerCase().includes(creditorLower)) continue;
          const txMs = new Date(t.date + 'T00:00:00Z').getTime();
          if (Math.abs(txMs - dueMs) > tolMs) continue;
          if (Math.abs(Math.abs(t.amount) - line.amount) > 0.5) continue;
          matched = { tx: t, statementId: stmt.id };
          break;
        }
        if (matched) break;
      }
      if (!matched) continue;
      await this.loans.addOccurrence(loan.id, {
        statementId: matched.statementId,
        date: matched.tx.date,
        amount: matched.tx.amount,
        transactionId: matched.tx.id,
        description: matched.tx.description,
      });
      await this.loans.markInstallmentPaid(loan.id, i, matched.statementId);
      marked++;
    }
    if (marked > 0) {
      this.logger.log(`Retro-matched installment loan ${loan.id}: ${marked}/${schedule.length} past dueDates marked paid`);
    }
  }

  /**
   * Branche B : relevé mensuel classique (revolving / amortissable).
   */
  private async importStandardCreditStatement(
    extracted: CreditStatementAnalysis,
  ): Promise<{ loan: Loan; created: boolean; matchConfidence?: MatchResult['confidence']; matchReason?: string }> {
    const signals: MatchSignals = {
      contractRef: extracted.accountNumber,
      rumNumber: extracted.rumNumber,
      creditor: extracted.creditor,
      monthlyAmount: extracted.monthlyPayment,
    };
    const idSuffix = extracted.accountNumber
      ? extracted.accountNumber.slice(-4)
      : extracted.rumNumber?.slice(-4);
    const baseName = `${extracted.creditor}${idSuffix ? ` · ${idSuffix}` : ''}`;
    const defaults: LoanDefaults = {
      name: baseName,
      type: extracted.creditType,
      kind: extracted.creditType,
      category: 'consumer',
      monthlyPayment: extracted.monthlyPayment,
      matchPattern: extracted.creditor,
      isActive: true,
      creditor: extracted.creditor,
      contractRef: extracted.accountNumber ?? undefined,
      rumRefs: extracted.rumNumber ? [extracted.rumNumber] : undefined,
      startDate: extracted.startDate ?? extracted.statementDate,
      endDate: extracted.endDate ?? undefined,
      maxAmount: extracted.creditType === 'revolving' ? extracted.maxAmount : undefined,
      usedAmount: extracted.creditType === 'revolving' ? Math.max(0, extracted.currentBalance) : undefined,
    };
    const result = await this.findOrCreate(signals, defaults);

    // Applique le snapshot canonique sur le loan (nouveau ou existant)
    const updated = await this.loans.applyStatementSnapshot(result.loan.id, {
      creditor: extracted.creditor,
      creditType: extracted.creditType,
      currentBalance: extracted.currentBalance,
      maxAmount: extracted.maxAmount,
      monthlyPayment: extracted.monthlyPayment,
      endDate: extracted.endDate,
      taeg: extracted.taeg,
      statementDate: extracted.statementDate,
    });

    // Auto-enrich rumRefs[] si match existant + nouveau RUM
    if (!result.created && extracted.rumNumber) {
      await this.loans.attachRumRef(updated.id, extracted.rumNumber);
    }

    return { ...result, loan: updated };
  }

  /**
   * Import d'un tableau d'amortissement : si attachToLoanId fourni, applique
   * direct ; sinon find-or-create via signals (creditor + monthlyAmount) puis
   * applique.
   */
  async importAmortization(
    extracted: AmortizationSnapshotInput,
    attachToLoanId?: string,
  ): Promise<{ loan: Loan; created: boolean; matchConfidence?: MatchResult['confidence']; matchReason?: string }> {
    if (attachToLoanId) {
      const loan = await this.loans.applyAmortizationSchedule(attachToLoanId, extracted);
      return { loan, created: false, matchReason: 'explicit attachToLoanId' };
    }

    // No attachId : find-or-create via signals
    const signals: MatchSignals = {
      creditor: extracted.creditor,
      monthlyAmount: extracted.monthlyPayment,
    };
    const defaults: LoanDefaults = {
      name: `${extracted.creditor} · ${Math.round(extracted.initialPrincipal)}€`,
      type: 'classic',
      category: 'consumer',
      monthlyPayment: extracted.monthlyPayment,
      matchPattern: extracted.creditor,
      isActive: true,
      creditor: extracted.creditor,
      startDate: extracted.startDate,
      endDate: extracted.endDate,
      initialPrincipal: extracted.initialPrincipal,
    };
    const result = await this.findOrCreate(signals, defaults);
    const updated = await this.loans.applyAmortizationSchedule(result.loan.id, extracted);
    return { ...result, loan: updated };
  }
}
