export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

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
  // Classic
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;
  // Revolving
  maxAmount?: number;
  usedAmount?: number;
  lastManualResetAt?: string;
  // Tracking
  occurrencesDetected: LoanOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;
