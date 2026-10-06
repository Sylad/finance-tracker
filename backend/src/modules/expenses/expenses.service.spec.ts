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

  it('paire neutre à cheval sur 2 relevés : débit fin juin, crédit début juillet', async () => {
    getAllStatements.mockResolvedValue([
      { id: '2026-07', transactions: [tx('in-j', 120, { date: '2026-07-02' }), tx('b', -10, { date: '2026-07-03' })] },
      { id: '2026-06', transactions: [tx('out-j', -120, { date: '2026-06-29' })] },
    ]);
    const june = await svc.getBreakdown('2026-06');
    expect(june.buckets.neutral.total).toBe(120);
    expect(june.categories).toHaveLength(0);
    const july = await svc.getBreakdown('2026-07');
    expect(july.buckets.neutral.total).toBe(0);
    expect(july.categories[0].total).toBe(10);
  });

  it('appariement global par proximité : un débit voisin ne vole pas le crédit plus proche', () => {
    const neutral = ExpensesService.findNeutralOutgoingTxIds([
      tx('far', -50, { date: '2026-07-03' }),
      tx('near', -50, { date: '2026-07-08' }),
      tx('in', 50, { date: '2026-07-09' }),
    ] as never);
    expect(neutral.has('near')).toBe(true);
    expect(neutral.has('far')).toBe(false);
  });

  it("l'épargne n'est jamais appariée : un virement d'épargne entrant ne rend pas un achat neutre", async () => {
    getAllStatements.mockResolvedValue([
      { id: '2026-07', transactions: [tx('buy', -800, { date: '2026-07-02', category: 'shopping' })] },
      { id: '2026-06', transactions: [tx('sav-in', 800, { date: '2026-06-30' })] },
    ]);
    savingsGetAll.mockResolvedValue([{ movements: [{ transactionId: 'sav-in' }] }]);
    const july = await svc.getBreakdown('2026-07');
    expect(july.buckets.neutral.total).toBe(0);
    expect(july.categories[0]).toEqual(expect.objectContaining({ category: 'shopping', total: 800 }));
  });

  it("un débit d'épargne ne consomme pas le crédit d'une vraie paire neutre", async () => {
    getAllStatements.mockResolvedValue([{
      id: '2026-07',
      transactions: [
        tx('sav-out', -50, { date: '2026-07-10' }),
        tx('real-out', -50, { date: '2026-07-04' }),
        tx('in', 50, { date: '2026-07-08' }),
      ],
    }]);
    savingsGetAll.mockResolvedValue([{ movements: [{ transactionId: 'sav-out' }] }]);
    const out = await svc.getBreakdown('2026-07');
    expect(out.buckets.savings.total).toBe(50);
    expect(out.buckets.neutral.total).toBe(50);
  });

  it("le matchPattern d'un crédit actif écarte la tx de l'appariement", () => {
    const neutral = ExpensesService.findNeutralOutgoingTxIds(
      [
        tx('pay', -120, { description: 'PRLV FLOA 123', date: '2026-07-05' }),
        tx('in', 120, { date: '2026-07-06' }),
      ] as never,
      new Set(),
      ['FLOA'],
    );
    expect(neutral.has('pay')).toBe(false);
  });

  const loansAvecMotifs = [
    { isActive: true, matchPattern: 'FLOA', occurrencesDetected: [] },
    { isActive: false, matchPattern: 'ACME', occurrencesDetected: [] },
  ];

  it('getBreakdown : le motif d\'un crédit actif écarte la paire, celui d\'un crédit inactif non', async () => {
    getAllStatements.mockResolvedValue([{
      id: '2026-07',
      transactions: [
        tx('floa-out', -120, { description: 'PRLV FLOA 123', date: '2026-07-05' }),
        tx('floa-in', 120, { date: '2026-07-06' }),
        tx('acme-out', -60, { description: 'PRLV ACME', date: '2026-07-05' }),
        tx('acme-in', 60, { date: '2026-07-06' }),
      ],
    }]);
    loansGetAll.mockResolvedValue(loansAvecMotifs);
    const out = await svc.getBreakdown('2026-07');
    expect(out.buckets.neutral.transactions.map((t) => t.id)).toEqual(['acme-out']);
    expect(out.categories.flatMap((c) => c.transactions.map((t) => t.id))).toEqual(['floa-out']);
  });

  describe('proposeCuts', () => {
    it('apparie sur les relevés à plat (paire à cheval) et exclut crédits/abos/épargne', async () => {
      getAllStatements.mockResolvedValue([
        { id: '2026-07', transactions: [tx('in-j', 120, { date: '2026-07-02' })] },
        { id: '2026-06', transactions: [
          tx('out-j', -120, { date: '2026-06-29' }),
          tx('t-loan', -10), tx('t-sub', -11), tx('t-sav', -12),
        ] },
      ]);
      loansGetAll.mockResolvedValue([{ occurrencesDetected: [{ transactionId: 't-loan' }] }]);
      subsGetAll.mockResolvedValue([{ occurrencesDetected: [{ transactionId: 't-sub' }] }]);
      savingsGetAll.mockResolvedValue([{ movements: [{ transactionId: 't-sav' }] }]);
      const build = jest.spyOn(svc['clustering'], 'buildClusters').mockReturnValue([]);
      await svc.proposeCuts();
      const excluded = build.mock.calls[0][1] as Set<string>;
      expect([...excluded].sort()).toEqual(['out-j', 't-loan', 't-sav', 't-sub']);
    });

    it("le motif d'un crédit actif écarte la paire, celui d'un crédit inactif non", async () => {
      getAllStatements.mockResolvedValue([
        { id: '2026-07', transactions: [
          tx('floa-out', -120, { description: 'PRLV FLOA 123', date: '2026-07-05' }),
          tx('floa-in', 120, { date: '2026-07-06' }),
          tx('acme-out', -60, { description: 'PRLV ACME', date: '2026-07-05' }),
          tx('acme-in', 60, { date: '2026-07-06' }),
        ] },
      ]);
      loansGetAll.mockResolvedValue(loansAvecMotifs);
      const build = jest.spyOn(svc['clustering'], 'buildClusters').mockReturnValue([]);
      await svc.proposeCuts();
      expect([...(build.mock.calls[0][1] as Set<string>)]).toEqual(['acme-out']);
    });

    it("l'épargne entrante ne rend pas un débit neutre", async () => {
      getAllStatements.mockResolvedValue([
        { id: '2026-07', transactions: [tx('buy', -800, { date: '2026-07-02' })] },
        { id: '2026-06', transactions: [tx('sav-in', 800, { date: '2026-06-30' })] },
      ]);
      savingsGetAll.mockResolvedValue([{ movements: [{ transactionId: 'sav-in' }] }]);
      const build = jest.spyOn(svc['clustering'], 'buildClusters').mockReturnValue([]);
      await svc.proposeCuts();
      expect((build.mock.calls[0][1] as Set<string>).has('buy')).toBe(false);
    });
  });
});
