export type SubscriptionFrequency = 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionCategory =
  | 'streaming'
  | 'utility'
  | 'software'
  | 'membership'
  | 'telecom'
  | 'insurance'
  | 'other';

export type SubscriptionOccurrenceSource = 'bank_statement' | 'manual';

export interface SubscriptionOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
  description?: string;
  source?: SubscriptionOccurrenceSource;
}

export interface Subscription {
  id: string;
  name: string;
  creditor?: string;
  monthlyAmount: number;
  frequency: SubscriptionFrequency;
  category: SubscriptionCategory;
  contractRef?: string;
  matchPattern: string;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  occurrencesDetected: SubscriptionOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionInput = Omit<
  Subscription,
  'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'
>;
