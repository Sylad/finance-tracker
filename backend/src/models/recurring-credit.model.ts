export type RecurringCreditFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'irregular';
export type RecurringCreditCategory = 'salary' | 'rental' | 'pension' | 'subsidy' | 'investment' | 'other';
export type EndDateConfidence = 'high' | 'medium' | 'low' | 'none';

export interface RecurringCredit {
  id: string;
  description: string;
  normalizedDescription: string;
  monthlyAmount: number;
  currency: string;
  frequency: RecurringCreditFrequency;
  firstSeenDate: string;
  lastSeenDate: string;
  contractEndDate?: string | null;
  endDateConfidence: EndDateConfidence;
  category: RecurringCreditCategory;
  isActive: boolean;
}
