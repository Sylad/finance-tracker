import { ScoreCalculatorService } from './score-calculator.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 'x',
    date: '2026-03-01',
    description: '',
    normalizedDescription: '',
    amount: 0,
    currency: 'EUR',
    category: 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
    ...over,
  };
}

function stmt(over: Partial<MonthlyStatement>): MonthlyStatement {
  return {
    id: '2026-03',
    month: 3,
    year: 2026,
    uploadedAt: '2026-04-01T00:00:00Z',
    bankName: 'LBP',
    accountHolder: 'Test',
    currency: 'EUR',
    openingBalance: 1000,
    closingBalance: 1000,
    totalCredits: 0,
    totalDebits: 0,
    transactions: [],
    healthScore: { total: 0, breakdown: { savingsRate: 0, expenseControl: 0, debtBurden: 0, cashFlowBalance: 0, irregularSpending: 0 }, trend: 'insufficient_data', claudeComment: '' },
    recurringCredits: [],
    analysisNarrative: '',
    externalAccountBalances: [],
    ...over,
  };
}

describe('ScoreCalculatorService', () => {
  const svc = new ScoreCalculatorService();

  describe('determinism', () => {
    it('same input → same output (10 runs)', () => {
      const s = stmt({
        openingBalance: 1500, closingBalance: 1700,
        transactions: [
          tx({ date: '2026-03-02', amount: 2800, category: 'income', subcategory: 'salary' }),
          tx({ date: '2026-03-05', amount: -1200, category: 'housing', subcategory: 'mortgage' }),
          tx({ date: '2026-03-10', amount: -450, category: 'food' }),
          tx({ date: '2026-03-15', amount: -200, category: 'savings', subcategory: 'savings' }),
          tx({ date: '2026-03-20', amount: -50, category: 'subscriptions' }),
        ],
      });
      const ref = svc.compute(s);
      for (let i = 0; i < 10; i++) {
        expect(svc.compute(s)).toEqual(ref);
      }
    });
  });

  describe('savingsRate', () => {
    it('=1 when 30%+ of income goes to savings', () => {
      const s = stmt({
        openingBalance: 1000, closingBalance: 1000,
        transactions: [
          tx({ amount: 1000, category: 'income' }),
          tx({ amount: -300, category: 'savings', subcategory: 'savings' }),
        ],
      });
      expect(svc.computeFactors(s).savingsRate).toBe(1);
    });

    it('=0 when no income', () => {
      const s = stmt({ openingBalance: 1000, closingBalance: 1000, transactions: [] });
      expect(svc.computeFactors(s).savingsRate).toBe(0);
    });

    it('counts positive balance delta as savings', () => {
      const s = stmt({
        openingBalance: 1000, closingBalance: 1300,
        transactions: [tx({ amount: 1000, category: 'income' })],
      });
      // 300 / 1000 / 0.3 = 1.0
      expect(svc.computeFactors(s).savingsRate).toBe(1);
    });
  });

  describe('expenseControl', () => {
    it('=1 with no debits', () => {
      const s = stmt({ transactions: [] });
      expect(svc.computeFactors(s).expenseControl).toBe(1);
    });

    it('=1 when discretionary ≤10% of debits', () => {
      const s = stmt({
        transactions: [
          tx({ amount: -900, category: 'housing' }),
          tx({ amount: -100, category: 'entertainment' }),
        ],
      });
      // discretionary 100 / 1000 = 0.10 → 1.0
      expect(svc.computeFactors(s).expenseControl).toBe(1);
    });

    it('=0 when discretionary ≥40%', () => {
      const s = stmt({
        transactions: [
          tx({ amount: -600, category: 'housing' }),
          tx({ amount: -400, category: 'entertainment' }),
        ],
      });
      expect(svc.computeFactors(s).expenseControl).toBe(0);
    });
  });

  describe('debtBurden', () => {
    it('=1 when fixed costs ≤30% of income', () => {
      const s = stmt({
        transactions: [
          tx({ amount: 3000, category: 'income' }),
          tx({ amount: -900, category: 'housing', subcategory: 'mortgage' }),
        ],
      });
      expect(svc.computeFactors(s).debtBurden).toBe(1);
    });

    it('=0 when fixed costs ≥60% of income', () => {
      const s = stmt({
        transactions: [
          tx({ amount: 1000, category: 'income' }),
          tx({ amount: -700, category: 'housing' }),
        ],
      });
      expect(svc.computeFactors(s).debtBurden).toBe(0);
    });

    it('counts loan subcategory across categories', () => {
      const s = stmt({
        transactions: [
          tx({ amount: 1000, category: 'income' }),
          tx({ amount: -500, category: 'transfers', subcategory: 'loan' }),
        ],
      });
      // 500/1000 = 0.50 → halfway between 0.30 (=1) and 0.60 (=0) → ~0.33
      expect(svc.computeFactors(s).debtBurden).toBeCloseTo(0.333, 2);
    });
  });

  describe('cashFlowBalance', () => {
    it('=1 with +10% growth', () => {
      const s = stmt({ openingBalance: 1000, closingBalance: 1100 });
      expect(svc.computeFactors(s).cashFlowBalance).toBe(1);
    });

    it('=0 with -10% drop', () => {
      const s = stmt({ openingBalance: 1000, closingBalance: 900 });
      expect(svc.computeFactors(s).cashFlowBalance).toBe(0);
    });

    it('=0.5 when balance is unchanged', () => {
      const s = stmt({ openingBalance: 1000, closingBalance: 1000 });
      expect(svc.computeFactors(s).cashFlowBalance).toBeCloseTo(0.5, 2);
    });

    it('handles zero opening without divide-by-zero', () => {
      const s = stmt({ openingBalance: 0, closingBalance: 0 });
      const f = svc.computeFactors(s);
      expect(f.cashFlowBalance).toBeCloseTo(0.5, 2);
    });
  });

  describe('irregularSpending', () => {
    it('=0.5 when too few daily data points', () => {
      const s = stmt({
        transactions: [tx({ date: '2026-03-01', amount: -100 }), tx({ date: '2026-03-02', amount: -200 })],
      });
      expect(svc.computeFactors(s).irregularSpending).toBe(0.5);
    });

    it('=1 when daily debits are smooth (CV ≤ 0.5)', () => {
      const s = stmt({
        transactions: Array.from({ length: 10 }, (_, i) => tx({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, amount: -100 })),
      });
      expect(svc.computeFactors(s).irregularSpending).toBe(1);
    });

    it('=0 when daily debits are very spiky (CV ≥ 2)', () => {
      // 9 small days + 1 big day → CV ≈ 2.97
      const txs = [
        ...Array.from({ length: 9 }, (_, i) => tx({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, amount: -1 })),
        tx({ date: '2026-03-10', amount: -1000 }),
      ];
      const s = stmt({ transactions: txs });
      expect(svc.computeFactors(s).irregularSpending).toBe(0);
    });
  });

  describe('compute (aggregate)', () => {
    it('returns total in [0, 100]', () => {
      const s = stmt({
        openingBalance: 1000, closingBalance: 1100,
        transactions: [
          tx({ date: '2026-03-02', amount: 2800, category: 'income' }),
          tx({ date: '2026-03-05', amount: -800, category: 'housing' }),
          tx({ date: '2026-03-10', amount: -300, category: 'food' }),
        ],
      });
      const score = svc.compute(s);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
      expect(score.breakdown.savingsRate).toBeGreaterThanOrEqual(0);
    });

    it('passes through claudeComment unchanged', () => {
      const s = stmt({});
      const out = svc.compute(s, 'Bon mois, attention aux loisirs.');
      expect(out.claudeComment).toBe('Bon mois, attention aux loisirs.');
    });
  });
});
