export type LoanSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'snoozed';
export type SuggestedExpenseType = 'loan' | 'subscription' | 'utility';

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
  status: LoanSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  acceptedAsLoanId?: string;
}

export interface IncomingSuggestion {
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenDate: string;
  suggestedType: SuggestedExpenseType;
  matchPattern: string;
}
