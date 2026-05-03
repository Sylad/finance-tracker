import { Injectable, Logger } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
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
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement, claudeSuggestions: IncomingSuggestion[] = []): Promise<void> {
    await this.autoDiscoverSavings(statement);
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    if (claudeSuggestions.length > 0) {
      await this.suggestions.upsertMany(statement.id, claudeSuggestions);
    }
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
}
