export type ScoreTrend = 'improving' | 'stable' | 'declining' | 'insufficient_data';

export interface ScoreBreakdown {
  savingsRate: number;
  expenseControl: number;
  debtBurden: number;
  cashFlowBalance: number;
  irregularSpending: number;
}

export interface FinancialHealthScore {
  total: number;
  breakdown: ScoreBreakdown;
  trend: ScoreTrend;
  claudeComment: string;
}

export interface ScoreHistoryEntry {
  id: string;
  month: number;
  year: number;
  score: number;
  trend: ScoreTrend;
}
