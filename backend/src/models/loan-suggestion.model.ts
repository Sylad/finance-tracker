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

/**
 * Preuves brutes derrière une suggestion issue de la détection LLM
 * (Round 5 fix 1) — permet à l'utilisateur de juger une suggestion sans
 * deviner ce qu'il y a derrière un simple « vu N fois ». Rempli par
 * DetectionValidatorService pour TOUTE suggestion issue de la détection
 * (installment, loan, subscription), jamais pour les suggestions
 * `claude_import` historiques.
 */
export interface SuggestionEvidence {
  /** Occurrences observées, plafonnées aux 12 plus récentes. */
  occurrences: { date: string; amount: number; description: string }[];
  /** Rationale de la ClusterClassification LLM — null si absent. */
  rationale: string | null;
  /** Date de la dernière occurrence observée. */
  lastSeenDate: string;
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
  /** Preuves (opérations + rationale) — absent = comportement historique. */
  evidence?: SuggestionEvidence;
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
  evidence?: SuggestionEvidence;
}
