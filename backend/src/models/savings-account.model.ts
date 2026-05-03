export type SavingsAccountType = 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';

export type SavingsMovementSource = 'initial' | 'detected' | 'manual' | 'interest' | 'bank-extract';

export interface SavingsMovement {
  id: string;
  date: string;
  amount: number;
  source: SavingsMovementSource;
  statementId: string | null;
  transactionId: string | null;
  note?: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: SavingsAccountType;
  initialBalance: number;
  initialBalanceDate: string;
  matchPattern: string;
  accountNumber?: string;
  interestRate: number;
  interestAnniversaryMonth: number;
  currentBalance: number;
  lastSyncedStatementId: string | null;
  movements: SavingsMovement[];
  createdAt: string;
  updatedAt: string;
}

export type SavingsAccountInput = Omit<
  SavingsAccount,
  'id' | 'currentBalance' | 'lastSyncedStatementId' | 'movements' | 'createdAt' | 'updatedAt'
>;

export interface BalanceHistoryEntry {
  month: string;
  balance: number;
}
