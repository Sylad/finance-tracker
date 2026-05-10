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
   * et marque paid via `markInstallmentPaid`. Idempotent.
   *
   * Critères :
   *   - description contient creditor (case-insensitive, accents normalisés)
   *     OU contient le merchant (ex: "AMAZON")
   *   - date dans une fenêtre asymétrique [dueDate-3j, dueDate+15j] :
   *     Cofidis et autres organismes prélèvent typiquement 7-11 jours APRÈS
   *     la date d'échéance contractuelle (constaté sur les relevés LBP).
   *   - montant ±0.50€
   *   - cross-loan dedup : la transaction n'est pas déjà allouée comme
   *     occurrence d'un autre loan installment actif (l'invariant 1 débit
   *     /mois max par crédit s'applique aussi : 1 débit ↔ 1 loan unique).
   */
  private async retroMatchInstallment(loan: Loan): Promise<void> {
    const schedule = loan.installmentSchedule;
    if (!schedule || schedule.length === 0) return;
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const creditorNorm = norm(loan.creditor ?? '');
    const merchantNorm = norm(loan.installmentMerchant ?? '');
    if (!creditorNorm && !merchantNorm) return;

    // Cross-loan : tx déjà utilisées par d'autres installment loans → exclues.
    const allLoans = await this.loans.getAll();
    const usedTxIds = new Set<string>();
    for (const other of allLoans) {
      if (other.id === loan.id) continue;
      for (const occ of other.occurrencesDetected) {
        if (occ.transactionId) usedTxIds.add(occ.transactionId);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const allStatements = await this.storage.getAllStatements();
    const localUsed = new Set<string>(); // tx déjà allouées DANS ce retro-match (pour ce loan)
    let marked = 0;
    for (let i = 0; i < schedule.length; i++) {
      const line = schedule[i];
      if (line.paid) continue;
      if (line.dueDate > today) continue; // future

      const dueMs = new Date(line.dueDate + 'T00:00:00Z').getTime();
      const lowerBoundMs = dueMs - 3 * 24 * 3600 * 1000;   // ±3j avant
      const upperBoundMs = dueMs + 15 * 24 * 3600 * 1000;  // jusqu'à 15j après

      type Candidate = { tx: { id: string; date: string; amount: number; description: string }; statementId: string; deltaMs: number };
      let best: Candidate | null = null;
      for (const stmt of allStatements) {
        for (const t of stmt.transactions) {
          if (t.amount >= 0) continue; // débit only
          if (usedTxIds.has(t.id) || localUsed.has(t.id)) continue;
          const desc = norm(t.description);
          const matchesCreditor = creditorNorm && desc.includes(creditorNorm);
          const matchesMerchant = merchantNorm && desc.includes(merchantNorm);
          if (!matchesCreditor && !matchesMerchant) continue;
          const txMs = new Date(t.date + 'T00:00:00Z').getTime();
          if (txMs < lowerBoundMs || txMs > upperBoundMs) continue;
          if (Math.abs(Math.abs(t.amount) - line.amount) > 0.5) continue;
          const delta = Math.abs(txMs - dueMs);
          if (!best || delta < best.deltaMs) {
            best = { tx: t, statementId: stmt.id, deltaMs: delta };
          }
        }
      }
      if (!best) continue;
      localUsed.add(best.tx.id);
      await this.loans.addOccurrence(loan.id, {
        statementId: best.statementId,
        date: best.tx.date,
        amount: best.tx.amount,
        transactionId: best.tx.id,
        description: best.tx.description,
      });
      await this.loans.markInstallmentPaid(loan.id, i, best.tx.id);
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
