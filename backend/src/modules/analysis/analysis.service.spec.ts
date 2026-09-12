import { Test } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { AnthropicService } from './anthropic.service';
import { StorageService } from '../storage/storage.service';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AutoSyncService } from '../auto-sync/auto-sync.service';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { ScoreCalculatorService } from '../score/score-calculator.service';
import type { MonthlyStatement } from '../../models/monthly-statement.model';

const salaryStmt = (id: string, amount: number, txAmount = amount): MonthlyStatement => ({
  id, month: Number(id.slice(5)), year: 2026, uploadedAt: '', bankName: 'LBP', accountHolder: 'S', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: txAmount, totalDebits: 0,
  transactions: [{ id: `t-${id}`, date: `${id}-28`, description: 'Virement ACME Salaire', normalizedDescription: 'virement acme salaire',
    amount: txAmount, currency: 'EUR', category: 'income', subcategory: '', isRecurring: true, confidence: 1 }],
  healthScore: { total: 0, breakdown: { savingsRate: 0, expenseControl: 0, debtBurden: 0, cashFlowBalance: 0, irregularSpending: 0 }, trend: 'insufficient_data', claudeComment: 'c' },
  recurringCredits: [{ id: `rc-${id}`, description: 'Virement ACME Salaire', normalizedDescription: 'Salaire ACME', monthlyAmount: amount, currency: 'EUR',
    frequency: 'monthly', firstSeenDate: `${id}-28`, lastSeenDate: `${id}-28`, endDateConfidence: 'none', category: 'salary', isActive: true }],
  analysisNarrative: '',
});

describe('AnalysisService.applyExceptionalIncome', () => {
  let svc: AnalysisService;
  let storage: { getAllStatements: jest.Mock };
  let scoreCalc: { compute: jest.Mock };

  beforeEach(async () => {
    storage = { getAllStatements: jest.fn().mockResolvedValue([salaryStmt('2026-06', 3000), salaryStmt('2026-07', 3100)]) };
    scoreCalc = { compute: jest.fn().mockReturnValue({ total: 42, breakdown: {}, trend: 'insufficient_data', claudeComment: 'c' }) };
    const mod = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: AnthropicService, useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: SnapshotService, useValue: {} },
        { provide: AutoSyncService, useValue: {} },
        { provide: CategoryRulesService, useValue: {} },
        { provide: ScoreCalculatorService, useValue: scoreCalc },
      ],
    }).compile();
    svc = mod.get(AnalysisService);
  });

  it('applique la règle avec l\'historique stocké et recalcule le score quand un revenu est flaggé', async () => {
    const stmt = salaryStmt('2026-08', 37000);
    const flags = await svc.applyExceptionalIncome(stmt);
    expect(flags).toHaveLength(1);
    expect(stmt.transactions[0].exceptionalAmount).toBe(33950);
    expect(stmt.recurringCredits[0].monthlyAmount).toBe(3050);
    expect(scoreCalc.compute).toHaveBeenCalledWith(stmt, 'c');
    expect(stmt.healthScore.total).toBe(42);
  });

  it('ne recalcule pas le score quand rien n\'est flaggé', async () => {
    const stmt = salaryStmt('2026-08', 3200);
    expect(await svc.applyExceptionalIncome(stmt)).toEqual([]);
    expect(scoreCalc.compute).not.toHaveBeenCalled();
  });
});
