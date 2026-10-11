export interface YearlyMonthScore {
  month: number;
  score: number;
}

export interface YearlyMonthCashFlow {
  month: number;
  credits: number;
  debits: number;
  net: number;
}

export interface YearlyCategoryTotal {
  category: string;
  totalAmount: number;
}

export interface YearlySummary {
  year: number;
  generatedAt: string;
  monthsCovered: number[];
  currency: string;
  totalCredits: number;
  totalDebits: number;
  netSavings: number;
  averageMonthlyCredits: number;
  averageMonthlyDebits: number;
  averageHealthScore: number;
  bestMonth: YearlyMonthScore;
  worstMonth: YearlyMonthScore;
  scoreProgression: YearlyMonthScore[];
  /** Absent des bilans écrits avant L65 ; le stockage le recalcule à la lecture. */
  monthlyCashFlow?: YearlyMonthCashFlow[];
  topCategories: YearlyCategoryTotal[];
  recurringCreditsCount: number;
}
