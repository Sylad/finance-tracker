import type { YearlySummary } from '@/types/api';
import { formatMonthShort } from './utils';

export interface CashFlowPoint {
  label: string;
  credits: number;
  debits: number;
}

/** Entrées / sorties mensuelles en € du bilan ; vide si le bilan n'en porte pas. */
export function cashFlowSeries(summary: YearlySummary): CashFlowPoint[] {
  return (summary.monthlyCashFlow ?? []).map((m) => ({
    label: formatMonthShort(m.month, summary.year),
    credits: m.credits,
    debits: m.debits,
  }));
}
