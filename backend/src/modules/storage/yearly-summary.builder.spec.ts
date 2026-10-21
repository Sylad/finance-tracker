import { MonthlyStatement } from '../../models/monthly-statement.model';
import { buildYearlySummary } from './yearly-summary.builder';

function stmt(month: number, credits: number, debits: number, score: number): MonthlyStatement {
  return {
    id: `2025-${String(month).padStart(2, '0')}`,
    month,
    year: 2025,
    currency: 'EUR',
    totalCredits: credits,
    totalDebits: debits,
    transactions: [],
    healthScore: { total: score },
    recurringCredits: [],
  } as unknown as MonthlyStatement;
}

describe('buildYearlySummary — flux mensuels', () => {
  it('expose les entrées et sorties en € de chaque mois, triées par mois', () => {
    const s = buildYearlySummary(2025, [stmt(3, 2100.456, 1900, 70), stmt(1, 2000, 2300.5, 40)])!;
    expect(s.monthlyCashFlow).toEqual([
      { month: 1, credits: 2000, debits: 2300.5, net: -300.5 },
      { month: 3, credits: 2100.46, debits: 1900, net: 200.46 },
    ]);
  });

  it("n'altère pas la progression du score", () => {
    const s = buildYearlySummary(2025, [stmt(1, 2000, 1000, 55)])!;
    expect(s.scoreProgression).toEqual([{ month: 1, score: 55 }]);
  });
});

describe('buildYearlySummary — versé en épargne (L104)', () => {
  const withTx = (txs: Array<{ amount: number; category: string }>) =>
    ({ ...stmt(1, 2000, 1500, 60), transactions: txs }) as unknown as MonthlyStatement;

  it("savingsDeposited somme les sorties de catégorie épargne, en valeur positive", () => {
    const s = buildYearlySummary(2025, [
      withTx([{ amount: -200.5, category: 'savings' }, { amount: -50, category: 'food' }]),
      { ...withTx([{ amount: -100, category: 'savings' }]), month: 2 } as MonthlyStatement,
    ])!;
    expect(s.savingsDeposited).toBe(300.5);
  });

  it("ignore les entrées de catégorie épargne (retraits) et vaut 0 sans versement", () => {
    const s = buildYearlySummary(2025, [withTx([{ amount: 400, category: 'savings' }])])!;
    expect(s.savingsDeposited).toBe(0);
  });
});
