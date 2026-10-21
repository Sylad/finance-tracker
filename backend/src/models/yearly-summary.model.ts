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
  /** Entrées − sorties de l'année (solde net) : ne dit rien de ce qui a été mis de côté. */
  netSavings: number;
  /** Total des sorties de catégorie épargne (€, positif). Absent des bilans écrits avant L104 ; le stockage le recalcule à la lecture. */
  savingsDeposited?: number;
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
