import { Injectable, Logger } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { SavingsAccount } from '../../models/savings-account.model';

@Injectable()
export class AutoSyncService {
  private readonly logger = new Logger(AutoSyncService.name);

  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement): Promise<void> {
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    this.bus.emit('accounts-synced');
  }

  async removeForStatement(statementId: string): Promise<void> {
    await this.savings.removeMovementsForStatement(statementId);
    await this.loans.removeOccurrencesForStatement(statementId);
    this.bus.emit('accounts-synced');
  }

  private async syncSavings(statement: MonthlyStatement): Promise<void> {
    const accounts = await this.savings.getAll();
    for (const acc of accounts) {
      if (!acc.matchPattern) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(acc.matchPattern, 'i');
      } catch (e) {
        this.logger.warn(`Invalid regex on savings ${acc.id}: ${acc.matchPattern}`);
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
