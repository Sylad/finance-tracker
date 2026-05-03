import { Injectable, Logger } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { SavingsAccount } from '../../models/savings-account.model';
import type { IncomingSuggestion } from '../../models/loan-suggestion.model';

function normalizeAccountNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[^0-9A-Z]/gi, '').toUpperCase();
}

@Injectable()
export class AutoSyncService {
  private readonly logger = new Logger(AutoSyncService.name);

  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly suggestions: LoanSuggestionsService,
    private readonly storage: StorageService,
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement, claudeSuggestions: IncomingSuggestion[] = []): Promise<void> {
    await this.autoDiscoverSavings(statement);
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    if (claudeSuggestions.length > 0) {
      await this.suggestions.upsertMany(statement.id, claudeSuggestions);
    }
    await this.autoCreateLoansFromSuggestions();
    await this.autoDeactivateStaleLoans();
    this.bus.emit('accounts-synced');
  }

  /**
   * Auto-discovery : pour chaque compte épargne externe affiché dans le PDF qui n'est
   * pas encore connu (par accountNumber), on le crée avec defaults intelligents.
   */
  private async autoDiscoverSavings(statement: MonthlyStatement): Promise<void> {
    const externals = statement.externalAccountBalances ?? [];
    for (const eb of externals) {
      if (!eb.accountNumber || eb.balance == null) continue;
      try {
        const result = await this.savings.upsertFromBankExtract(eb, statement.month, statement.year);
        if (result.created) {
          this.logger.log(`Auto-discovered savings account: ${result.account.name} (${eb.accountType})`);
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-discover savings for accountNumber=${eb.accountNumber}: ${(e as Error).message}`);
      }
    }
  }

  async removeForStatement(statementId: string): Promise<void> {
    await this.savings.removeMovementsForStatement(statementId);
    await this.loans.removeOccurrencesForStatement(statementId);
    this.bus.emit('accounts-synced');
  }

  private async syncSavings(statement: MonthlyStatement): Promise<void> {
    const accounts = await this.savings.getAll();
    const externalBalances = statement.externalAccountBalances ?? [];

    for (const acc of accounts) {
      let handled = false;

      // Priority 1: bank-extract recalibration (if account has an accountNumber)
      if (acc.accountNumber) {
        const normAcc = normalizeAccountNumber(acc.accountNumber);
        const match = externalBalances.find(
          (eb) => normalizeAccountNumber(eb.accountNumber) === normAcc,
        );
        if (match) {
          // Idempotence: skip if a bank-extract movement for this statement already exists
          const alreadyDone = acc.movements.some(
            (m) => m.source === 'bank-extract' && m.statementId === statement.id,
          );
          if (!alreadyDone) {
            const delta = Math.round((match.balance - acc.currentBalance) * 100) / 100;
            await this.savings.addMovement(acc.id, {
              date: match.asOfDate ?? `${statement.year}-${String(statement.month).padStart(2, '0')}-01`,
              amount: delta,
              source: 'bank-extract',
              statementId: statement.id,
              transactionId: null,
              note: 'Solde recalibré depuis le relevé',
            });
          }
          await this.maybeAddInterest(acc, statement);
          handled = true;
        }
      }

      if (handled) continue;

      // Priority 2: match by targetAccountNumber on transactions
      if (acc.accountNumber) {
        const normAcc = normalizeAccountNumber(acc.accountNumber);
        const txMatches = statement.transactions.filter(
          (t) => t.targetAccountNumber && normalizeAccountNumber(t.targetAccountNumber) === normAcc,
        );
        if (txMatches.length > 0) {
          for (const t of txMatches) {
            const epargneAmount = -t.amount;
            await this.safeAddMovement(acc, t, epargneAmount, statement.id);
          }
          await this.maybeAddInterest(acc, statement);
          handled = true;
        }
      }

      if (handled) continue;

      // Priority 3: regex fallback
      if (!acc.matchPattern) {
        await this.maybeAddInterest(acc, statement);
        continue;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(acc.matchPattern, 'i');
      } catch (e) {
        this.logger.warn(`Invalid regex on savings ${acc.id}: ${acc.matchPattern}`);
        await this.maybeAddInterest(acc, statement);
        continue;
      }
      const matches = statement.transactions.filter((t) => regex.test(t.description));
      for (const t of matches) {
        // Convention : un débit côté courant (amount<0) = dépôt sur compte épargne (+).
        const epargneAmount = -t.amount;
        await this.safeAddMovement(acc, t, epargneAmount, statement.id);
      }
      await this.maybeAddInterest(acc, statement);
    }
  }

  private async safeAddMovement(acc: SavingsAccount, t: Transaction, amount: number, statementId: string): Promise<void> {
    const dup = acc.movements.some((m) => m.statementId === statementId && m.transactionId === t.id);
    if (dup) return;
    await this.savings.addMovement(acc.id, {
      date: t.date,
      amount,
      source: 'detected',
      statementId,
      transactionId: t.id,
      note: `Auto: ${t.description}`,
    });
  }

  private async maybeAddInterest(acc: SavingsAccount, statement: MonthlyStatement): Promise<void> {
    if (statement.month !== acc.interestAnniversaryMonth) return;
    const alreadyDone = acc.movements.some((m) => m.source === 'interest' && m.date.startsWith(`${statement.year}-`));
    if (alreadyDone) return;
    // Estimation simple : balance courante × taux annuel.
    const interest = Math.round(acc.currentBalance * acc.interestRate * 100) / 100;
    if (interest <= 0) return;
    await this.savings.addMovement(acc.id, {
      date: `${statement.year}-${String(statement.month).padStart(2, '0')}-31`,
      amount: interest,
      source: 'interest',
      statementId: statement.id,
      transactionId: null,
      note: `Intérêts ${statement.year} (${(acc.interestRate * 100).toFixed(2)}%)`,
    });
  }

  private async syncLoans(statement: MonthlyStatement): Promise<void> {
    const loans = await this.loans.getAll();
    for (const loan of loans) {
      if (!loan.isActive || !loan.matchPattern) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(loan.matchPattern, 'i');
      } catch {
        this.logger.warn(`Invalid regex on loan ${loan.id}: ${loan.matchPattern}`);
        continue;
      }
      const matches = statement.transactions.filter((t) => regex.test(t.description));
      for (const t of matches) {
        await this.loans.addOccurrence(loan.id, {
          statementId: statement.id,
          date: t.date,
          amount: t.amount,
          transactionId: t.id,
        });
      }
    }
  }

  private async autoCreateLoansFromSuggestions(): Promise<void> {
    const suggestions = await this.suggestions.getPending();

    // Group loan-type suggestions by creditor
    type SuggWithCreditor = (typeof suggestions)[number] & { creditor: string };
    const byCreditor = new Map<string, SuggWithCreditor[]>();
    for (const s of suggestions) {
      if (s.suggestedType !== 'loan' || !s.creditor) continue;
      const key = s.creditor.toLowerCase().trim();
      if (!byCreditor.has(key)) byCreditor.set(key, []);
      byCreditor.get(key)!.push(s as SuggWithCreditor);
    }

    // For each creditor with no existing Loan, auto-create one
    const existingLoans = await this.loans.getAll();
    const existingCreditors = new Set(
      existingLoans.map((l) => (l.creditor ?? '').toLowerCase().trim()).filter(Boolean),
    );

    for (const [creditorKey, sugs] of byCreditor.entries()) {
      if (existingCreditors.has(creditorKey)) continue;
      const totalMonthly = sugs.reduce((sum, s) => sum + s.monthlyAmount, 0);
      const avgMonthly = Math.round((totalMonthly / sugs.length) * 100) / 100;
      const creditor = sugs[0].creditor;
      const escaped = creditor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchPattern = escaped.split(/\s+/).join('.*');
      await this.loans.create({
        name: creditor,
        type: 'classic',
        category: 'consumer',
        monthlyPayment: avgMonthly,
        matchPattern,
        isActive: true,
        creditor,
      });
      this.logger.log(`Auto-created Loan for creditor ${creditor} (avg ${avgMonthly}€/mois)`);
      // Snooze all suggestions for this creditor (they're now covered by the auto-created loan)
      for (const s of sugs) {
        try {
          await this.suggestions.snooze(s.id);
        } catch { /* ignore */ }
      }
    }
  }

  private async autoDeactivateStaleLoans(): Promise<void> {
    const loans = await this.loans.getAll();
    const allStatements = await this.storage.getAllStatements();
    // Build sorted list of statement months (YYYY-MM)
    const sortedMonths = allStatements
      .map((s) => `${s.year}-${String(s.month).padStart(2, '0')}`)
      .sort();
    if (sortedMonths.length < 3) return; // not enough history yet
    const recentMonths = new Set(sortedMonths.slice(-3));

    // Skip loans created in the last 60 seconds — they were just auto-created
    // and haven't had a chance to accumulate occurrences yet (sync runs the
    // create+detect+deactivate trio in one pass).
    const freshThresholdMs = Date.now() - 60_000;

    for (const loan of loans) {
      if (!loan.isActive) continue;
      if (new Date(loan.createdAt).getTime() > freshThresholdMs) continue;
      const seenInRecent = loan.occurrencesDetected.some((o) => {
        const m = o.date.slice(0, 7);
        return recentMonths.has(m);
      });
      if (!seenInRecent) {
        const { id: _id, occurrencesDetected: _occ, createdAt: _ca, updatedAt: _ua, ...loanInput } = loan;
        void _id; void _occ; void _ca; void _ua;
        await this.loans.update(loan.id, {
          ...loanInput,
          isActive: false,
        });
        this.logger.log(`Auto-deactivated loan ${loan.name} (no occurrence in last 3 months)`);
      }
    }
  }
}
