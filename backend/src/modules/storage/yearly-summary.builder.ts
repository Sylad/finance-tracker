import { MonthlyStatement } from '../../models/monthly-statement.model';
import { TransactionCategory } from '../../models/transaction.model';
import { YearlyMonthCashFlow, YearlySummary } from '../../models/yearly-summary.model';
import { round2 } from '../../common/money';


/** Entrées / sorties en € de chaque mois (tri par mois). */
export function buildMonthlyCashFlow(statements: MonthlyStatement[]): YearlyMonthCashFlow[] {
  return [...statements]
    .sort((a, b) => a.month - b.month)
    .map((s) => ({
      month: s.month,
      credits: round2(s.totalCredits),
      debits: round2(s.totalDebits),
      net: round2(s.totalCredits - s.totalDebits),
    }));
}

/** Agrège les relevés d'une année en bilan annuel (null si aucun relevé). */
export function buildYearlySummary(year: number, statements: MonthlyStatement[]): YearlySummary | null {
  if (statements.length === 0) return null;

  const currency = statements[0].currency;
  const totalCredits = statements.reduce((s, m) => s + m.totalCredits, 0);
  const totalDebits = statements.reduce((s, m) => s + m.totalDebits, 0);
  const scores = statements.map((s) => ({ month: s.month, score: s.healthScore.total }));
  const avgScore = Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length);
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = scores.reduce((a, b) => (b.score < a.score ? b : a));

  // Aggregate spending by category
  const categoryTotals = new Map<string, number>();
  for (const s of statements) {
    for (const t of s.transactions) {
      if (t.amount < 0) {
        const cat = t.category as TransactionCategory;
        categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + Math.abs(t.amount));
      }
    }
  }
  const topCategories = [...categoryTotals.entries()]
    .map(([category, totalAmount]) => ({ category, totalAmount: Math.round(totalAmount * 100) / 100 }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 6);

  const recurringCreditsCount = new Set(
    statements.flatMap((s) => s.recurringCredits.map((r) => r.normalizedDescription.toLowerCase())),
  ).size;

  const n = statements.length;
  return {
    year,
    generatedAt: new Date().toISOString(),
    monthsCovered: statements.map((s) => s.month).sort((a, b) => a - b),
    currency,
    totalCredits: Math.round(totalCredits * 100) / 100,
    totalDebits: Math.round(totalDebits * 100) / 100,
    netSavings: Math.round((totalCredits - totalDebits) * 100) / 100,
    averageMonthlyCredits: Math.round((totalCredits / n) * 100) / 100,
    averageMonthlyDebits: Math.round((totalDebits / n) * 100) / 100,
    averageHealthScore: avgScore,
    bestMonth: best,
    worstMonth: worst,
    scoreProgression: scores,
    monthlyCashFlow: buildMonthlyCashFlow(statements),
    topCategories,
    recurringCreditsCount,
  };
}
