export type TransactionCategory =
  | 'income' | 'housing' | 'transport' | 'food' | 'health'
  | 'entertainment' | 'subscriptions' | 'savings' | 'transfers' | 'taxes' | 'other';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  normalizedDescription: string;
  amount: number;
  currency: string;
  category: TransactionCategory;
  subcategory: string;
  isRecurring: boolean;
  recurringCreditEndDate?: string | null;
  confidence: number;
}

export interface ScoreBreakdown {
  savingsRate: number;
  expenseControl: number;
  debtBurden: number;
  cashFlowBalance: number;
  irregularSpending: number;
}

export type ScoreTrend = 'improving' | 'stable' | 'declining' | 'insufficient_data';

export interface FinancialHealthScore {
  total: number;
  breakdown: ScoreBreakdown;
  trend: ScoreTrend;
  claudeComment: string;
}

export type RecurringCreditFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'irregular';
export type RecurringCreditCategory = 'salary' | 'rental' | 'pension' | 'subsidy' | 'investment' | 'other';

export interface RecurringCredit {
  id: string;
  description: string;
  normalizedDescription: string;
  monthlyAmount: number;
  currency: string;
  frequency: RecurringCreditFrequency;
  firstSeenDate: string;
  lastSeenDate: string;
  contractEndDate?: string | null;
  endDateConfidence: 'high' | 'medium' | 'low' | 'none';
  category: RecurringCreditCategory;
  isActive: boolean;
}

export interface MonthlyStatement {
  id: string;
  month: number;
  year: number;
  uploadedAt: string;
  bankName: string;
  accountHolder: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  transactions: Transaction[];
  healthScore: FinancialHealthScore;
  recurringCredits: RecurringCredit[];
  analysisNarrative: string;
}

export interface StatementSummary {
  id: string;
  month: number;
  year: number;
  uploadedAt: string;
  bankName: string;
  accountHolder: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  healthScore: number;
  trend: ScoreTrend;
  transactionCount: number;
}

export interface ScoreHistoryEntry {
  id: string;
  month: number;
  year: number;
  score: number;
  trend: ScoreTrend;
}

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

export const EXPENSE_CATEGORIES: TransactionCategory[] = [
  'housing', 'transport', 'food', 'health', 'entertainment', 'subscriptions', 'taxes', 'other',
];

export const ALL_CATEGORIES: TransactionCategory[] = [
  'income', 'housing', 'transport', 'food', 'health',
  'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
];

export const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  income: 'Revenus', housing: 'Logement', transport: 'Transport',
  food: 'Alimentation', health: 'Santé', entertainment: 'Loisirs',
  subscriptions: 'Abonnements', savings: 'Épargne', transfers: 'Virements',
  taxes: 'Impôts', other: 'Autre',
};

export const CATEGORY_ICONS: Record<TransactionCategory, string> = {
  income: 'TrendingUp', housing: 'Home', transport: 'Car',
  food: 'UtensilsCrossed', health: 'Heart', entertainment: 'Gamepad2',
  subscriptions: 'Repeat', savings: 'PiggyBank', transfers: 'ArrowLeftRight',
  taxes: 'Landmark', other: 'MoreHorizontal',
};

export type Budget = Partial<Record<TransactionCategory, number>>;

export type DeclarationType = 'income' | 'loan' | 'subscription' | 'expense';
export type DeclarationPeriodicity = 'monthly' | 'quarterly' | 'yearly' | 'one-shot';

export interface Declaration {
  id: string;
  type: DeclarationType;
  label: string;
  amount: number;
  periodicity: DeclarationPeriodicity;
  startDate: string | null;
  endDate: string | null;
  category: string;
  notes: string;
  matchPattern: string;
  createdAt: string;
  updatedAt: string;
}

export type DeclarationInput = Omit<Declaration, 'id' | 'createdAt' | 'updatedAt'>;

export interface ForecastOccurrence {
  declarationId: string;
  label: string;
  type: DeclarationType;
  category: string;
  amountSigned: number;
  matched: boolean;
  matchedTxId: string | null;
}

export interface ForecastMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  occurrences: ForecastOccurrence[];
}

export const DECLARATION_TYPE_LABELS: Record<DeclarationType, string> = {
  income: 'Revenu',
  loan: 'Crédit',
  subscription: 'Abonnement',
  expense: 'Dépense',
};

export const PERIODICITY_LABELS: Record<DeclarationPeriodicity, string> = {
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  yearly: 'Annuel',
  'one-shot': 'Ponctuel',
};

export interface UploadResultItem {
  statement: MonthlyStatement;
  replaced: boolean;
  filename: string;
}

export interface UploadResult {
  succeeded: UploadResultItem[];
  skipped: Array<{ filename: string; statementId: string }>;
  failed: Array<{ filename: string; error: string }>;
}

export interface ClaudeUsage {
  month: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedCostEur: number;
  budgetEur: number;
  percent: number;
  hasBalance: boolean;
  estimatedRemainingEur: number | null;
  configuredBalanceEur: number | null;
  remainingPercent: number | null;
}

export type SavingsAccountType = 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';

export const SAVINGS_TYPE_LABELS: Record<SavingsAccountType, string> = {
  'livret-a': 'Livret A',
  pel: 'PEL',
  cel: 'CEL',
  ldds: 'LDDS',
  pea: 'PEA',
  other: 'Autre',
};

export interface SavingsMovement {
  id: string;
  date: string;
  amount: number;
  source: 'initial' | 'detected' | 'manual' | 'interest';
  statementId: string | null;
  transactionId: string | null;
  note?: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: SavingsAccountType;
  initialBalance: number;
  initialBalanceDate: string;
  matchPattern: string;
  interestRate: number;
  interestAnniversaryMonth: number;
  currentBalance: number;
  lastSyncedStatementId: string | null;
  movements: SavingsMovement[];
  createdAt: string;
  updatedAt: string;
}

export type SavingsAccountInput = Omit<
  SavingsAccount,
  'id' | 'currentBalance' | 'lastSyncedStatementId' | 'movements' | 'createdAt' | 'updatedAt'
>;

export interface BalanceHistoryEntry {
  month: string;
  balance: number;
}

export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

export const LOAN_CATEGORY_LABELS: Record<LoanCategory, string> = {
  mortgage: 'Immobilier',
  consumer: 'Conso',
  auto: 'Auto',
  student: 'Étudiant',
  other: 'Autre',
};

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
}

export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  category: LoanCategory;
  monthlyPayment: number;
  matchPattern: string;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;
  maxAmount?: number;
  usedAmount?: number;
  lastManualResetAt?: string;
  occurrencesDetected: LoanOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;

export type LoanSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'snoozed';

export interface LoanSuggestion {
  id: string;
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenStatementId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  suggestedType: 'loan' | 'subscription' | 'utility';
  matchPattern: string;
  status: LoanSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  acceptedAsLoanId?: string;
}
