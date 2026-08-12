export type LoanSuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'snoozed';
export type SuggestedExpenseType = 'loan' | 'subscription' | 'utility';
export type LoanSuggestionSource = 'claude_import' | 'llm_detection';

/**
 * Détail d'une série installment (paiement N fois) détectée par
 * DetectionValidatorService — porté par la suggestion pour permettre
 * aux Tasks 4-6 de reconstruire un Loan kind='installment' à l'acceptation.
 */
export interface InstallmentSuggestionInfo {
  count: number | null; // nb d'échéances estimé par le LLM (null = inconnu)
  merchant: string | null;
  occurrenceTxIds: string[]; // transactions observées de la série
  amounts: number[]; // montants observés (positifs)
  dates: string[]; // dates observées YYYY-MM-DD
}

export interface LoanSuggestion {
  id: string;
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenStatementId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  suggestedType: SuggestedExpenseType;
  matchPattern: string;
  creditor?: string;
  status: LoanSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  acceptedAsLoanId?: string;
  acceptedAsSubscriptionId?: string;
  installment?: InstallmentSuggestionInfo;
  /** Origine de la suggestion — absent = comportement historique (claude_import). */
  source?: LoanSuggestionSource;
}

export interface IncomingSuggestion {
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenDate: string;
  suggestedType: SuggestedExpenseType;
  matchPattern: string;
  creditor?: string;
  installment?: InstallmentSuggestionInfo;
  source?: LoanSuggestionSource;
}
