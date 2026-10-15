import { Logger } from '@nestjs/common';
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

describe('AnalysisService — resynchro épargne en replay (L5)', () => {
  let svc: AnalysisService;
  let storage: { getStatement: jest.Mock; saveStatement: jest.Mock };
  let autoSync: { removeForStatement: jest.Mock; syncStatement: jest.Mock };
  const stmt = salaryStmt('2026-03', 3000);

  beforeEach(async () => {
    storage = { getStatement: jest.fn(), saveStatement: jest.fn() };
    autoSync = { removeForStatement: jest.fn(), syncStatement: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: AnthropicService, useValue: { analyzeBankStatement: jest.fn().mockResolvedValue({ suggestedRecurringExpenses: [] }) } },
        { provide: StorageService, useValue: storage },
        { provide: SnapshotService, useValue: { takeSnapshot: jest.fn() } },
        { provide: AutoSyncService, useValue: autoSync },
        { provide: CategoryRulesService, useValue: { applyWithHits: jest.fn().mockImplementation(async (t) => ({ transactions: t, matchedIds: new Set() })) } },
        { provide: ScoreCalculatorService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(AnalysisService);
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(stmt);
    jest.spyOn(svc, 'applyExceptionalIncome').mockResolvedValue([]);
  });

  it('reanalyze : le re-sync passe replay (pas d\'intérêts estimés sur le solde du jour)', async () => {
    storage.getStatement.mockResolvedValue(stmt);
    await svc.reanalyzeStatement('2026-03', Buffer.from(''));
    expect(autoSync.syncStatement).toHaveBeenCalledWith(stmt, [], { replay: true });
  });

  it('remplacement d\'un relevé existant : replay', async () => {
    storage.getStatement.mockResolvedValue(stmt);
    await svc.analyzeAndPersist(Buffer.from(''));
    expect(autoSync.syncStatement).toHaveBeenCalledWith(stmt, [], { replay: true });
  });

  it('nouveau relevé : import normal, estimation autorisée', async () => {
    storage.getStatement.mockResolvedValue(null);
    await svc.analyzeAndPersist(Buffer.from(''));
    expect(autoSync.syncStatement).toHaveBeenCalledWith(stmt, [], { replay: false });
  });
});

describe('AnalysisService — dictionnaire de marchands (L75)', () => {
  let svc: AnalysisService;
  let storage: { getStatement: jest.Mock; saveStatement: jest.Mock };
  let rules: { applyWithHits: jest.Mock };
  let logSpy: jest.SpyInstance;

  const dictStmt = (): MonthlyStatement => {
    const s = salaryStmt('2026-03', 3000);
    const base = { currency: 'EUR', subcategory: '', isRecurring: false, confidence: 1, date: '2026-03-05' };
    s.transactions = [
      { ...base, id: 'a', description: 'PAIEMENT CB 1203 CARREFOUR MARKET 12/03', normalizedDescription: 'paiement cb carrefour market', amount: -30, category: 'other' },
      { ...base, id: 'b', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR', amount: -10, category: 'health' },
      { ...base, id: 'c', description: 'CARREFOUR REMBOURSEMENT', normalizedDescription: 'CARREFOUR REMBOURSEMENT', amount: 20, category: 'income' },
      { ...base, id: 'd', description: 'BOULANGERIE', normalizedDescription: 'BOULANGERIE', amount: -3, category: 'health' },
    ];
    return s;
  };

  beforeEach(async () => {
    storage = { getStatement: jest.fn().mockResolvedValue(null), saveStatement: jest.fn() };
    rules = { applyWithHits: jest.fn().mockImplementation(async (t) => ({ transactions: t, matchedIds: new Set() })) };
    const mod = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: AnthropicService, useValue: { analyzeBankStatement: jest.fn().mockResolvedValue({ suggestedRecurringExpenses: [] }) } },
        { provide: StorageService, useValue: storage },
        { provide: SnapshotService, useValue: { takeSnapshot: jest.fn() } },
        { provide: AutoSyncService, useValue: { removeForStatement: jest.fn(), syncStatement: jest.fn() } },
        { provide: CategoryRulesService, useValue: rules },
        { provide: ScoreCalculatorService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(AnalysisService);
    jest.spyOn(svc, 'applyExceptionalIncome').mockResolvedValue([]);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('R7 — sans règle, le dictionnaire l\'emporte sur la catégorie de Claude', async () => {
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    const { statement } = await svc.analyzeAndPersist(Buffer.from(''));
    expect(statement.transactions.map((t) => t.category)).toEqual(['food', 'food', 'income', 'health']);
  });

  it('R7 — une règle utilisateur sur CARREFOUR vers other l\'emporte sur le dictionnaire', async () => {
    rules.applyWithHits.mockImplementation(async (txs: any[]) => ({
      transactions: txs.map((t) => (t.id === 'b' ? { ...t, category: 'other' } : t)),
      matchedIds: new Set(['b']),
    }));
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    const { statement } = await svc.analyzeAndPersist(Buffer.from(''));
    expect(statement.transactions.find((t) => t.id === 'b')?.category).toBe('other');
    expect(statement.transactions.find((t) => t.id === 'a')?.category).toBe('food');
  });

  it('R8 — un crédit CARREFOUR garde sa catégorie dans l\'analyse', async () => {
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    const { statement } = await svc.analyzeAndPersist(Buffer.from(''));
    expect(statement.transactions.find((t) => t.id === 'c')?.category).toBe('income');
  });

  it('R6 — le log contient la version et le nombre exact de transactions recatégorisées', async () => {
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    await svc.analyzeAndPersist(Buffer.from(''));
    expect(logSpy).toHaveBeenCalledWith('Merchant dictionary v1: 2 transaction(s) recategorized');
  });

  it('R6 — la ré-analyse écrit le même log (A3)', async () => {
    storage.getStatement.mockResolvedValue(dictStmt());
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    const { statement } = await svc.reanalyzeStatement('2026-03', Buffer.from(''));
    expect(logSpy).toHaveBeenCalledWith('Merchant dictionary v1: 2 transaction(s) recategorized');
    expect(statement.transactions[0].category).toBe('food');
  });

  it('R6 — le relevé sauvegardé ne contient aucun champ de version', async () => {
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    await svc.analyzeAndPersist(Buffer.from(''));
    const saved = JSON.stringify(storage.saveStatement.mock.calls[0][0]);
    expect(saved).not.toMatch(/dictionary|version/i);
  });

  it('R1 — description et normalizedDescription sont conservées dans le relevé sauvegardé', async () => {
    jest.spyOn(svc as any, 'buildStatement').mockReturnValue(dictStmt());
    await svc.analyzeAndPersist(Buffer.from(''));
    const a = storage.saveStatement.mock.calls[0][0].transactions[0];
    expect(a.description).toBe('PAIEMENT CB 1203 CARREFOUR MARKET 12/03');
    expect(a.normalizedDescription).toBe('paiement cb carrefour market');
  });
});
