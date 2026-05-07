export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

/**
 * Source de l'occurrence — gère les décalages temporels entre relevés :
 * - bank_statement : occurrence détectée dans un relevé de compte bancaire
 *   (la mensualité a été prélevée sur le compte courant)
 * - credit_statement : occurrence détectée dans un relevé de crédit
 *   (l'organisme prêteur a émis un relevé pour cette mensualité)
 * - manual : saisie manuelle par l'utilisateur
 *
 * Quand la même mensualité apparaît dans bank ET credit (typique : 1-3 jours
 * d'écart), le syncLoans dédupe par (loanId, YYYY-MM) en gardant la source
 * de priorité supérieure : credit > bank > manual (le relevé de crédit est
 * la source canonique car émis par l'organisme prêteur lui-même).
 */
export type LoanOccurrenceSource = 'bank_statement' | 'credit_statement' | 'manual';

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
  description?: string;  // Libellé de la transaction d'origine (pour split par référence)
  source?: LoanOccurrenceSource;  // Default 'bank_statement' pour rétro-compat
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
