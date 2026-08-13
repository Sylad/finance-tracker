import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExpensesService } from './expenses.service';
import { StorageService } from '../storage/storage.service';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SavingsService } from '../savings/savings.service';
import { CandidateClusteringService } from '../credit-detection/candidate-clustering.service';

describe('ExpensesService — breakdown', () => {
  let svc: ExpensesService;
  let getAllStatements: jest.Mock;
  let loansGetAll: jest.Mock;
  let subsGetAll: jest.Mock;
  let savingsGetAll: jest.Mock;

  const tx = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
    id, date: '2026-07-10', description: `TX ${id}`, normalizedDescription: '',
    amount, currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 1, ...over,
  });

  beforeEach(async () => {
    getAllStatements = jest.fn();
    loansGetAll = jest.fn().mockResolvedValue([]);
    subsGetAll = jest.fn().mockResolvedValue([]);
    savingsGetAll = jest.fn().mockResolvedValue([]);
    const mod = await Test.createTestingModule({
      providers: [
        ExpensesService,
        CandidateClusteringService,
        { provide: StorageService, useValue: { getAllStatements } },
        { provide: LoansService, useValue: { getAll: loansGetAll } },
        { provide: SubscriptionsService, useValue: { getAll: subsGetAll } },
        { provide: SavingsService, useValue: { getAll: savingsGetAll } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(ExpensesService);
  });

  it('isole crédits, abonnements, épargne et neutres — le reste groupé par catégorie', async () => {
    getAllStatements.mockResolvedValue([{
      id: '2026-07', month: 7, year: 2026,
      transactions: [
        tx('t-loan', -284.41),
        tx('t-sub', -12.99),
        tx('t-sav', -75),
        tx('t-neutral-out', -1979, { date: '2026-07-05' }),
        tx('t-neutral-in', 1979, { date: '2026-07-03' }),
        tx('t-food', -50, { category: 'food' }),
        tx('t-other', -30),
      ],
    }]);
    loansGetAll.mockResolvedValue([{ occurrencesDetected: [{ transactionId: 't-loan' }] }]);
    subsGetAll.mockResolvedValue([{ occurrencesDetected: [{ transactionId: 't-sub' }] }]);
    savingsGetAll.mockResolvedValue([{ movements: [{ transactionId: 't-sav' }] }]);

    const out = await svc.getBreakdown('2026-07');
    expect(out.buckets.credits.total).toBe(284.41);
    expect(out.buckets.subscriptions.total).toBe(12.99);
    expect(out.buckets.savings.total).toBe(75);
    expect(out.buckets.neutral.total).toBe(1979);
    expect(out.categories).toEqual([
      expect.objectContaining({ category: 'food', total: 50 }),
      expect.objectContaining({ category: 'other', total: 30 }),
    ]);
    expect(out.totalDebits).toBe(284.41 + 12.99 + 75 + 1979 + 50 + 30);
  });

  it('paires neutres : montant ±0.01€ à ≤7 jours seulement', () => {
    const neutral = ExpensesService.findNeutralOutgoingTxIds([
      tx('out1', -85.9, { date: '2026-07-06' }),
      tx('in1', 85.9, { date: '2026-07-11' }),   // 5 jours → neutre
      tx('out2', -50, { date: '2026-07-01' }),
      tx('in2', 50, { date: '2026-07-20' }),      // 19 jours → PAS neutre
    ] as never);
    expect(neutral.has('out1')).toBe(true);
    expect(neutral.has('out2')).toBe(false);
  });
});
