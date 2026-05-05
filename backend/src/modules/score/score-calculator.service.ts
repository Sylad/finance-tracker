import { Injectable } from '@nestjs/common';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { FinancialHealthScore, ScoreTrend } from '../../models/financial-health-score.model';

export interface ScoreFactors {
  savingsRate: number;        // [0..1]
  expenseControl: number;     // [0..1]
  debtBurden: number;         // [0..1]
  cashFlowBalance: number;    // [0..1]
  irregularSpending: number;  // [0..1]
}

const WEIGHTS = {
  savingsRate: 0.25,
  expenseControl: 0.20,
  debtBurden: 0.20,
  cashFlowBalance: 0.20,
  irregularSpending: 0.15,
};

@Injectable()
export class ScoreCalculatorService {
  /**
   * Computes the 5 score dimensions and the aggregate score (0..100) purely
   * from the statement transactions + opening/closing balance. Pure function:
   * same input always yields the same output (no LLM, no clock, no I/O).
   *
   * `comment` is the (optional) Claude-generated narrative passed through as-is.
   */
  compute(statement: MonthlyStatement, comment = ''): FinancialHealthScore {
    const f = this.computeFactors(statement);
    const total = Math.round(
      (f.savingsRate * WEIGHTS.savingsRate +
        f.expenseControl * WEIGHTS.expenseControl +
        f.debtBurden * WEIGHTS.debtBurden +
        f.cashFlowBalance * WEIGHTS.cashFlowBalance +
        f.irregularSpending * WEIGHTS.irregularSpending) *
        100,
    );
    return {
      total,
      breakdown: {
        savingsRate: Math.round(f.savingsRate * 100),
        expenseControl: Math.round(f.expenseControl * 100),
        debtBurden: Math.round(f.debtBurden * 100),
        cashFlowBalance: Math.round(f.cashFlowBalance * 100),
        irregularSpending: Math.round(f.irregularSpending * 100),
      },
      trend: 'insufficient_data' as ScoreTrend,
      claudeComment: comment,
    };
  }

  computeFactors(statement: MonthlyStatement): ScoreFactors {
    const txs = statement.transactions ?? [];
    const income = sum(txs.filter((t) => t.amount > 0));
    const debits = sum(txs.filter((t) => t.amount < 0).map((t) => ({ ...t, amount: Math.abs(t.amount) })));

    return {
      savingsRate: this.savingsRate(txs, income, statement.openingBalance, statement.closingBalance),
      expenseControl: this.expenseControl(txs, debits),
      debtBurden: this.debtBurden(txs, income),
      cashFlowBalance: this.cashFlowBalance(statement.openingBalance, statement.closingBalance),
      irregularSpending: this.irregularSpending(txs),
    };
  }

  /**
   * savingsRate = (savings transfers + positive balance delta capped) / income.
   * Excellent at ≥30% of income. Capped to [0,1].
   */
  private savingsRate(txs: Transaction[], income: number, opening: number, closing: number): number {
    if (income <= 0) return 0;
    const savingsOut = sum(
      txs.filter((t) => t.amount < 0 && (t.category === 'savings' || t.subcategory === 'savings')).map((t) => ({ ...t, amount: Math.abs(t.amount) })),
    );
    const balanceDelta = Math.max(0, closing - opening);
    const totalSaved = savingsOut + balanceDelta;
    return clamp01(totalSaved / income / 0.3);
  }

  /**
   * expenseControl = 1 - discretionary_share where discretionary = entertainment + subscriptions.
   * Best at ≤10% of debits, worst at ≥40%. Linear in between.
   */
  private expenseControl(txs: Transaction[], totalDebits: number): number {
    if (totalDebits <= 0) return 1;
    const discretionary = sum(
      txs
        .filter((t) => t.amount < 0 && (t.category === 'entertainment' || t.category === 'subscriptions'))
        .map((t) => ({ ...t, amount: Math.abs(t.amount) })),
    );
    const ratio = discretionary / totalDebits;
    if (ratio <= 0.10) return 1;
    if (ratio >= 0.40) return 0;
    return 1 - (ratio - 0.10) / 0.30;
  }

  /**
   * debtBurden = 1 - (housing+loans+utilities) / income.
   * Best at ≤30% of income, worst at ≥60%.
   * Combines housing (rent/mortgage) and loan repayments — the classic French "33% rule".
   */
  private debtBurden(txs: Transaction[], income: number): number {
    if (income <= 0) return 0;
    const fixed = sum(
      txs
        .filter((t) => {
          if (t.amount >= 0) return false;
          if (t.category === 'housing') return true;
          if (t.subcategory === 'loan' || t.subcategory === 'mortgage' || t.subcategory === 'rent' || t.subcategory === 'utilities') return true;
          return false;
        })
        .map((t) => ({ ...t, amount: Math.abs(t.amount) })),
    );
    const ratio = fixed / income;
    if (ratio <= 0.30) return 1;
    if (ratio >= 0.60) return 0;
    return 1 - (ratio - 0.30) / 0.30;
  }

  /**
   * cashFlowBalance = remap (closing-opening)/max(opening, baseIncome) from [-0.10, +0.10] to [0, 1].
   * +10% growth = max, -10% drop = min.
   * Uses opening (or 1 if 0) as denominator to avoid division by 0.
   */
  private cashFlowBalance(opening: number, closing: number): number {
    const denom = Math.max(Math.abs(opening), 1);
    const delta = (closing - opening) / denom;
    if (delta >= 0.10) return 1;
    if (delta <= -0.10) return 0;
    return (delta + 0.10) / 0.20;
  }

  /**
   * irregularSpending = 1 - normalized coefficient of variation of daily debits.
   * Best when daily debits are smooth (CV ≤ 0.5), worst when very spiky (CV ≥ 2.0).
   * Linear interpolation in between. Returns 0.5 (neutral) if too few data points.
   *
   * CV bounds rationale: with N daily values where most are equal and one is a
   * single huge spike, CV plateaus around (N-1)/sqrt(N) ≈ 2-3. So CV=2.0 is
   * already very spiky in practice for typical bank statements.
   */
  private irregularSpending(txs: Transaction[]): number {
    const debitsByDay = new Map<string, number>();
    for (const t of txs) {
      if (t.amount >= 0) continue;
      debitsByDay.set(t.date, (debitsByDay.get(t.date) ?? 0) + Math.abs(t.amount));
    }
    const values = Array.from(debitsByDay.values());
    if (values.length < 3) return 0.5;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean === 0) return 0.5;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv <= 0.5) return 1;
    if (cv >= 2.0) return 0;
    return 1 - (cv - 0.5) / 1.5;
  }
}

function sum(items: { amount: number }[]): number {
  return items.reduce((s, i) => s + i.amount, 0);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
