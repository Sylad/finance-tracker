import { TransactionCategory } from './transaction.model';

export interface CategoryRule {
  id: string;
  pattern: string;
  flags: string;
  category: TransactionCategory | string;
  subcategory: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryRuleInput {
  pattern: string;
  flags?: string;
  category: string;
  subcategory?: string;
  priority?: number;
}

export interface UserCategory {
  id: string;
  name: string;
  createdAt: string;
}
