export interface YearlyMonthScore {
  month: number;
  score: number;
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
  topCategories: YearlyCategoryTotal[];
  recurringCreditsCount: number;
}
