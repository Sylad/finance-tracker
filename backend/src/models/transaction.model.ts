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
  targetAccountNumber?: string | null;
  /**
   * Part EXCEPTIONNELLE d'un crédit récurrent (solde de tout compte, prime,
   * rappel) : `amount − médiane des salaires précédents`. Posé par la règle
   * `applyExceptionalIncomeRule` quand un salaire dépasse 3 × sa médiane.
   * Score, diagnostic santé et prévisions raisonnent sur `effectiveIncome(t)`.
   */
  exceptionalAmount?: number;
}

/** Montant d'un crédit hors part exceptionnelle (= amount pour un débit ou un crédit ordinaire). */
export function effectiveIncome(t: Pick<Transaction, 'amount' | 'exceptionalAmount'>): number {
  return t.amount - (t.exceptionalAmount ?? 0);
}
