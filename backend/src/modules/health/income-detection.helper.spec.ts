import { detectStableIncome } from './income-detection.helper';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const tx = (id: string, date: string, description: string, amount: number) => ({
  id, date, description, normalizedDescription: description.toLowerCase(),
  amount, currency: 'EUR', category: 'income', subcategory: '', isRecurring: true, confidence: 1,
});
const stmt = (id: string, month: number, txs: ReturnType<typeof tx>[]): MonthlyStatement => ({
  id, month, year: 2026, uploadedAt: '', bankName: 'X', accountHolder: 'Demo', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, transactions: txs,
  healthScore: { total: 50, breakdown: { savingsRate: 50, expenseControl: 50, debtBurden: 50, cashFlowBalance: 50, irregularSpending: 50 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [], analysisNarrative: '', externalAccountBalances: [],
});

describe('detectStableIncome', () => {
  const salaryMonths = [
    stmt('2026-01', 1, [tx('s1', '2026-01-28', 'Virement ACME Corp salaire janvier', 2800)]),
    stmt('2026-02', 2, [tx('s2', '2026-02-27', 'Virement ACME CORP Salaire fevrier', 2950)]),
    stmt('2026-03', 3, [tx('s3', '2026-03-29', 'ACME Corp Salary', 2750),
                         tx('d1', '2026-03-10', 'Virement CrediCorp reserve', 900),
                         tx('r1', '2026-03-12', 'Mutuelle SanteX remboursement', 340)]),
  ];

  it('détecte le cluster salaire stable, exclut tirages et remboursement ponctuel', () => {
    const out = detectStableIncome(salaryMonths, new Set(['d1']), null);
    expect(out.source).toBe('detected');
    expect(out.monthly).toBe(2800); // médiane de 2800/2950/2750
    expect(out.label).toContain('acme');
  });

  it('manualMonthlyIncome prime sur la détection', () => {
    const out = detectStableIncome(salaryMonths, new Set(['d1']), 3100);
    expect(out).toEqual({ monthly: 3100, source: 'manual', label: null });
  });

  it('cluster présent < 3 mois → unavailable', () => {
    const out = detectStableIncome(salaryMonths.slice(0, 2), new Set(), null);
    expect(out.source).toBe('unavailable');
    expect(out.monthly).toBeNull();
  });

  it('montants instables (>±25%) → cluster rejeté', () => {
    const wobbly = [
      stmt('2026-01', 1, [tx('a', '2026-01-15', 'FreelanceX paiement', 1000)]),
      stmt('2026-02', 2, [tx('b', '2026-02-15', 'FreelanceX paiement', 2400)]),
      stmt('2026-03', 3, [tx('c', '2026-03-15', 'FreelanceX paiement', 600)]),
    ];
    expect(detectStableIncome(wobbly, new Set(), null).source).toBe('unavailable');
  });

  it('changement d\'employeur : ancien cluster absent du dernier mois + nouveau gros crédit → transition', () => {
    const months = [
      ...salaryMonths,
      stmt('2026-04', 4, [tx('n1', '2026-04-28', 'Virement NewJob SAS salaire', 3200)]),
    ];
    const out = detectStableIncome(months, new Set(), null);
    expect(out.source).toBe('transition');
    expect(out.monthly).toBe(2800); // médiane historique en attendant confirmation
  });

  it('les tirages ne forment jamais un cluster de revenu', () => {
    const drawsOnly = [
      stmt('2026-01', 1, [tx('d1', '2026-01-10', 'Virement CrediCorp reserve', 650)]),
      stmt('2026-02', 2, [tx('d2', '2026-02-10', 'Virement CrediCorp reserve', 650)]),
      stmt('2026-03', 3, [tx('d3', '2026-03-10', 'Virement CrediCorp reserve', 650)]),
    ];
    const out = detectStableIncome(drawsOnly, new Set(['d1', 'd2', 'd3']), null);
    expect(out.source).toBe('unavailable');
  });
});
