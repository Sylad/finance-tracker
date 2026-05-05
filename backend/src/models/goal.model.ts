export type GoalType = 'savings_total' | 'net_worth';

export interface FinancialGoal {
  id: string;
  name: string;
  type: GoalType;
  targetAmount: number;
  targetDate: string | null; // YYYY-MM-DD or null = open-ended
  startAmount: number;       // baseline at creation, used to compute "% done"
  startDate: string;         // YYYY-MM-DD
  createdAt: string;
}

export interface GoalInput {
  name: string;
  type: GoalType;
  targetAmount: number;
  targetDate?: string | null;
  startAmount?: number; // defaults to current value
}

export interface GoalWithProgress extends FinancialGoal {
  currentAmount: number;
  progressPct: number;       // 0..100
  remaining: number;
  monthlyPaceNeeded: number | null; // null if no targetDate
  projection: 'on-track' | 'ahead' | 'behind' | 'no-deadline' | 'achieved';
  monthsElapsed: number;
  monthsRemaining: number | null;
}
