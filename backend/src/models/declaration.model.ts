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
