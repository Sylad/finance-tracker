import { Transaction } from './transaction.model';
import { FinancialHealthScore } from './financial-health-score.model';
import { RecurringCredit } from './recurring-credit.model';

export interface ExternalAccountBalance {
  accountNumber: string;
  accountType: 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';
  balance: number;
  label?: string;
  asOfDate?: string;
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
  externalAccountBalances?: ExternalAccountBalance[];
}

export interface AnalysisResponse {
  statement: MonthlyStatement;
  replaced: boolean;
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
  trend: string;
  transactionCount: number;
}
