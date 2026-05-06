export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
  description?: string;  // Libellé de la transaction d'origine (pour split par référence)
}

export interface LoanStatementSnapshot {
  date: string;          // ISO timestamp de l'import
  source: 'pdf-import' | 'manual' | 'auto-sync';
  extractedValues: {
    currentBalance?: number;
    maxAmount?: number;
    monthlyPayment?: number;
    endDate?: string | null;
    statementDate?: string;
    taeg?: number | null;
  };
}

export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  category: LoanCategory;
  monthlyPayment: number;
  matchPattern: string;
  isActive: boolean;
  creditor?: string;
  contractRef?: string;  // N° de contrat manuel — prioritaire sur matchPattern
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
  // Snapshot du dernier relevé crédit importé
  lastStatementSnapshot?: LoanStatementSnapshot;
  createdAt: string;
  updatedAt: string;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;
