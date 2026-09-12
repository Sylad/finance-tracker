import { applyExceptionalIncomeRule, salaryBaseline } from './exceptional-income.helper';
import type { MonthlyStatement } from '../../models/monthly-statement.model';
import type { Transaction } from '../../models/transaction.model';
import type { RecurringCredit } from '../../models/recurring-credit.model';

const tx = (id: string, amount: number, description: string, over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-08-28', description, normalizedDescription: description.toLowerCase(), amount, currency: 'EUR',
  category: 'income', subcategory: '', isRecurring: true, confidence: 1, ...over,
});
const salary = (monthlyAmount: number, description = 'Virement S.A.S. Campbell Scientific Salaire'): RecurringCredit => ({
  id: `rc-${monthlyAmount}`, description, normalizedDescription: 'Salaire Campbell Scientific', monthlyAmount, currency: 'EUR',
  frequency: 'monthly', firstSeenDate: '2026-01-28', lastSeenDate: '2026-08-28', endDateConfidence: 'none', category: 'salary', isActive: true,
});
const stmt = (id: string, recurringCredits: RecurringCredit[], transactions: Transaction[] = []): MonthlyStatement => ({
  id, month: Number(id.slice(5)), year: Number(id.slice(0, 4)), uploadedAt: '', bankName: 'LBP', accountHolder: 'S', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, transactions,
  healthScore: { total: 0, breakdown: { savingsRate: 0, expenseControl: 0, debtBurden: 0, cashFlowBalance: 0, irregularSpending: 0 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits, analysisNarrative: '',
});

const previous = [
  stmt('2026-03', [salary(3444.06)]),
  stmt('2026-04', [salary(3408.06)]),
  stmt('2026-05', [salary(3424.06)]),
  stmt('2026-06', [salary(3860.56)]),
  stmt('2026-07', [salary(3381.91)]),
];

describe('salaryBaseline', () => {
  it('médiane des salaires récurrents des relevés précédents', () => {
    expect(salaryBaseline(previous)).toBeCloseTo(3424.06, 2);
  });
  it('null si moins de 2 relevés avec un salaire', () => {
    expect(salaryBaseline([previous[0]])).toBeNull();
    expect(salaryBaseline([])).toBeNull();
  });
});

describe('applyExceptionalIncomeRule', () => {
  it('un salaire > 3 × médiane : la tx porte l\'excédent, le crédit récurrent retombe à la médiane', () => {
    const current = stmt('2026-08', [salary(37065.66, 'Virement S.A.S. Campbell Scientific Salary SL')], [
      tx('t-sal', 37065.66, 'Virement S.A.S. Campbell Scientific Salary SL'),
      tx('t-other', 1040, 'Versement DAB', { category: 'other', isRecurring: false }),
    ]);
    const flagged = applyExceptionalIncomeRule(current, previous);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ transactionId: 't-sal', baseline: 3424.06 });
    expect(flagged[0].exceptionalAmount).toBeCloseTo(33641.6, 2);
    const t = current.transactions.find((x) => x.id === 't-sal')!;
    expect(t.exceptionalAmount).toBeCloseTo(33641.6, 2);
    expect(current.recurringCredits[0].monthlyAmount).toBeCloseTo(3424.06, 2);
    expect(current.transactions.find((x) => x.id === 't-other')!.exceptionalAmount).toBeUndefined();
  });

  it('un salaire normal n\'est pas touché', () => {
    const current = stmt('2026-08', [salary(3500)], [tx('t-sal', 3500, 'Virement S.A.S. Campbell Scientific Salaire')]);
    expect(applyExceptionalIncomeRule(current, previous)).toEqual([]);
    expect(current.recurringCredits[0].monthlyAmount).toBe(3500);
    expect(current.transactions[0].exceptionalAmount).toBeUndefined();
  });

  it('sans historique suffisant, rien n\'est fait', () => {
    const current = stmt('2026-08', [salary(37065.66)], [tx('t-sal', 37065.66, 'Virement S.A.S. Campbell Scientific Salaire')]);
    expect(applyExceptionalIncomeRule(current, [previous[0]])).toEqual([]);
  });

  it('idempotent : rejouer la règle sur un relevé déjà traité ne change rien', () => {
    const current = stmt('2026-08', [salary(37065.66)], [tx('t-sal', 37065.66, 'Virement S.A.S. Campbell Scientific Salaire')]);
    applyExceptionalIncomeRule(current, previous);
    const second = applyExceptionalIncomeRule(current, previous);
    expect(second).toEqual([]);
    expect(current.transactions[0].exceptionalAmount).toBeCloseTo(33641.6, 2);
    expect(current.recurringCredits[0].monthlyAmount).toBeCloseTo(3424.06, 2);
  });
});
