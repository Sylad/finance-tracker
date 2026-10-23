import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';

describe('DashboardService — getNetWorth restant dû officiel', () => {
  let svc: DashboardService;
  let loansGetAll: jest.Mock;

  const mkClassic = (over: Record<string, unknown>) => ({
    id: 'l1', name: 'Prêt', type: 'classic', category: 'consumer',
    monthlyPayment: 250, matchPattern: 'X', isActive: true,
    occurrencesDetected: [], createdAt: '', updatedAt: '', ...over,
  });
  const isoDaysAgo = (d: number) =>
    new Date(Date.now() - d * 24 * 3600 * 1000).toISOString().slice(0, 10);

  beforeEach(async () => {
    loansGetAll = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: SavingsService, useValue: { getAll: jest.fn().mockResolvedValue([]) } },
        { provide: LoansService, useValue: { getAll: loansGetAll } },
        {
          provide: StorageService,
          useValue: { getAllSummaries: jest.fn().mockResolvedValue([]), getAllStatements: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    svc = mod.get(DashboardService);
  });

  it('utilise le restant dû officiel (snapshot frais) au lieu de mensualités × mois restants', async () => {
    loansGetAll.mockResolvedValue([
      mkClassic({
        endDate: '2031-07-03',
        lastStatementSnapshot: {
          date: '', source: 'manual',
          extractedValues: { currentBalance: 11320.58, statementDate: isoDaysAgo(1) },
        },
      }),
    ]);
    const out = await svc.getNetWorth();
    expect(out.estimatedDebt).toBe(11320.58); // pas ~59 × 250
    expect(out.ignoredLoanIds).toHaveLength(0);
  });

  it('snapshot périmé (> 90 j) → retombe sur l’estimation mensualités × mois restants', async () => {
    loansGetAll.mockResolvedValue([
      mkClassic({
        endDate: '2031-07-03',
        lastStatementSnapshot: {
          date: '', source: 'manual',
          extractedValues: { currentBalance: 11320.58, statementDate: isoDaysAgo(120) },
        },
      }),
    ]);
    const out = await svc.getNetWorth();
    expect(out.estimatedDebt).toBeGreaterThan(12000); // estimation, pas le snapshot
  });

  it('kind=installment → dette = somme des échéances non payées (pas mois × mensualité)', async () => {
    loansGetAll.mockResolvedValue([
      mkClassic({
        kind: 'installment',
        monthlyPayment: 100,
        endDate: isoDaysAgo(-60), // dans 2 mois — l'estimation naïve donnerait 200
        installmentSchedule: [
          { dueDate: '2026-05-03', amount: 100, paid: true },
          { dueDate: '2026-06-03', amount: 100, paid: true },
          { dueDate: '2026-07-03', amount: 100, paid: true },
          { dueDate: '2026-09-03', amount: 100, paid: false },
        ],
      }),
    ]);
    const out = await svc.getNetWorth();
    expect(out.estimatedDebt).toBe(100);
  });

  it('sans endDate ni snapshot → loan ignoré et signalé', async () => {
    loansGetAll.mockResolvedValue([mkClassic({})]);
    const out = await svc.getNetWorth();
    expect(out.estimatedDebt).toBe(0);
    expect(out.ignoredLoanIds).toEqual(['l1']);
  });
  describe('getAlerts — fin de crédit proche', () => {
    const inDays = (d: number) => isoDaysAgo(-d);

    it('R1 — un crédit classique qui se termine dans moins de 90 jours lève l’alerte', async () => {
      loansGetAll.mockResolvedValue([mkClassic({ endDate: inDays(60) })]);
      const alerts = await svc.getAlerts();
      expect(alerts.map((a) => a.message)).toEqual([expect.stringMatching(/se termine dans/)]);
    });

    it('R2 — un paiement en plusieurs fois (kind=installment) ne lève jamais « se termine dans »', async () => {
      loansGetAll.mockResolvedValue([mkClassic({ kind: 'installment', endDate: inDays(60) })]);
      const alerts = await svc.getAlerts();
      expect(alerts.filter((a) => /se termine dans/.test(a.message))).toHaveLength(0);
    });

    it('R3 — kind=installment prime sur type=classic : même exclusion qu’au calcul de la dette', async () => {
      loansGetAll.mockResolvedValue([
        mkClassic({ id: 'a', kind: 'installment', endDate: inDays(30) }),
        mkClassic({ id: 'b', name: 'Auto', kind: 'classic', endDate: inDays(30) }),
      ]);
      const alerts = await svc.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toContain('Auto');
    });
  });
});
