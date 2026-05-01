export type TransactionCategory =
  | 'income'
  | 'housing'
  | 'transport'
  | 'food'
  | 'health'
  | 'entertainment'
  | 'subscriptions'
  | 'savings'
  | 'transfers'
  | 'taxes'
  | 'other';

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
