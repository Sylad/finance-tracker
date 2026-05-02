import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AnthropicService, ClaudeAnalysisResult } from './anthropic.service';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AutoSyncService } from '../auto-sync/auto-sync.service';
import { MonthlyStatement, AnalysisResponse } from '../../models/monthly-statement.model';
import { Transaction, TransactionCategory } from '../../models/transaction.model';
import { RecurringCredit } from '../../models/recurring-credit.model';
import { FinancialHealthScore, ScoreTrend } from '../../models/financial-health-score.model';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly autoSync: AutoSyncService,
  ) {}

  async reanalyzeStatement(id: string, pdfBuffer: Buffer): Promise<AnalysisResponse> {
    // Re-traite un statement existant avec le prompt FR actuel.
    // Utilisé pour migrer les anciens commentaires anglais vers le français.
    const existing = await this.storage.getStatement(id);
    if (!existing) throw new NotFoundException(`Relevé ${id} introuvable`);
    const result = await this.anthropic.analyzeBankStatement(pdfBuffer);
    const candidate = this.buildStatement(result);
    if (candidate.id !== id) {
      throw new BadRequestException(
        `Le PDF fourni correspond au relevé ${candidate.id}, pas au relevé ${id} demandé. Re-upload le bon PDF.`,
      );
    }
    await this.snapshots.takeSnapshot(`before-reanalyze-${id}`);
    await this.storage.saveStatement(candidate);
    try {
      await this.autoSync.syncStatement(candidate);
    } catch (e) {
      this.logger.error(`AutoSync failed for ${candidate.id}`, e as Error);
      // Don't block persistence — log and continue.
    }
    this.logger.log(`Re-analyzed statement ${id}`);
    return { statement: candidate, replaced: true };
  }

  async analyzeAndPersist(pdfBuffer: Buffer): Promise<AnalysisResponse> {
    const result = await this.anthropic.analyzeBankStatement(pdfBuffer);
    const statement = this.buildStatement(result);

    const existing = await this.storage.getStatement(statement.id);
    const replaced = existing !== null;

    await this.snapshots.takeSnapshot(replaced ? `before-replace-${statement.id}` : `before-save-${statement.id}`);
    await this.storage.saveStatement(statement);
    try {
      await this.autoSync.syncStatement(statement);
    } catch (e) {
      this.logger.error(`AutoSync failed for ${statement.id}`, e as Error);
      // Don't block persistence — log and continue.
    }
    this.logger.log(`${replaced ? 'Replaced' : 'Saved'} statement ${statement.id} (score: ${statement.healthScore.total})`);

    return { statement, replaced };
  }

  buildStatement(result: ClaudeAnalysisResult): MonthlyStatement {
    const month = result.statementMonth;
    const year = result.statementYear;
    const id = `${year}-${String(month).padStart(2, '0')}`;
    const currency = result.currency ?? 'EUR';

    const transactions: Transaction[] = result.transactions.map((t) => ({
      id: uuidv4(),
      date: t.date,
      description: t.description,
      normalizedDescription: t.normalizedDescription,
      amount: t.amount,
      currency,
      category: (t.category as TransactionCategory) ?? 'other',
      subcategory: t.subcategory ?? '',
      isRecurring: t.isRecurring ?? false,
      recurringCreditEndDate: t.recurringCreditEndDate ?? null,
      confidence: t.confidence ?? 0.5,
    }));

    const recurringCredits: RecurringCredit[] = (result.recurringCredits ?? []).map((rc) => {
      const endDate = rc.contractEndDate ?? null;
      const isActive = endDate ? new Date(endDate) >= new Date() : true;
      return {
        id: uuidv4(),
        description: rc.description,
        normalizedDescription: rc.normalizedDescription,
        monthlyAmount: rc.monthlyAmount,
        currency,
        frequency: (rc.frequency as RecurringCredit['frequency']) ?? 'monthly',
        firstSeenDate: rc.firstSeenDate,
        lastSeenDate: rc.lastSeenDate,
        contractEndDate: endDate,
        endDateConfidence: (rc.endDateConfidence as RecurringCredit['endDateConfidence']) ?? 'none',
        category: (rc.category as RecurringCredit['category']) ?? 'other',
        isActive,
      };
    });

    const healthScore = this.computeScore(result, id);

    const totalCredits = transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDebits = transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return {
      id,
      month,
      year,
      uploadedAt: new Date().toISOString(),
      bankName: result.bankName ?? 'Unknown',
      accountHolder: result.accountHolder ?? 'Unknown',
      currency,
      openingBalance: result.openingBalance ?? 0,
      closingBalance: result.closingBalance ?? 0,
      totalCredits,
      totalDebits,
      transactions,
      healthScore,
      recurringCredits,
      analysisNarrative: result.analysisNarrative ?? '',
    };
  }

  private computeScore(result: ClaudeAnalysisResult, id: string): FinancialHealthScore {
    const f = result.scoreFactors;

    const savingsRate = Math.max(0, Math.min(1, f.estimatedSavingsRate ?? 0));
    const expenseControl = Math.max(0, Math.min(1, 1 - (f.discretionaryRatio ?? 0.5)));
    const debtBurden = Math.max(0, Math.min(1, 1 - (f.recurringObligationRatio ?? 0.5)));
    const balanceTrend = Math.max(0, Math.min(1, (f.balanceTrend + 1) / 2));
    const irregularSpending = Math.max(0, Math.min(1, f.spendingVarianceScore ?? 0.5));

    const total = Math.round(
      (savingsRate * 0.25 +
        expenseControl * 0.20 +
        debtBurden * 0.20 +
        balanceTrend * 0.20 +
        irregularSpending * 0.15) *
        100,
    );

    return {
      total,
      breakdown: {
        savingsRate: Math.round(savingsRate * 100),
        expenseControl: Math.round(expenseControl * 100),
        debtBurden: Math.round(debtBurden * 100),
        cashFlowBalance: Math.round(balanceTrend * 100),
        irregularSpending: Math.round(irregularSpending * 100),
      },
      trend: 'insufficient_data' as ScoreTrend,
      claudeComment: result.claudeHealthComment ?? '',
    };
  }
}
