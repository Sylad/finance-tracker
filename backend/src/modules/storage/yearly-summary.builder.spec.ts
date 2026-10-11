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
