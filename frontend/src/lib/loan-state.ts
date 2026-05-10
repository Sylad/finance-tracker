/**
 * Port frontend du helper `computeLoanState` (backend
 * /backend/src/modules/loans/loans-state.helper.ts).
 *
 * Utilisé par `AmortizationChart` pour le calcul prévu vs réel sans
 * appel HTTP. Garde la même logique pour rester cohérent — toute évolution
 * du calcul doit être faite côté backend ET frontend, surveillée par
 * tests des deux côtés.
 */

import type { Loan, AmortizationLine } from '@/types/api';

export interface LoanState {
  asOfDate: string;
  capitalRemaining: {
    plannedFromSchedule: number | null;
    estimatedFromOccurrences: number | null;
    gap: number | null;
  };
  totalPaid: number;
  occurrencesCount: number;
  monthsActive: number;
  monthsRemaining: number | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsBetween(aIso: string, bIso: string): number {
  if (aIso > bIso) return 0;
  const a = new Date(aIso + 'T00:00:00Z');
  const b = new Date(bIso + 'T00:00:00Z');
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  );
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function findScheduleLineForMonth(
  schedule: AmortizationLine[],
  occMonth: string,
): AmortizationLine | null {
  let candidate: AmortizationLine | null = null;
  for (const line of schedule) {
    if (monthOf(line.date) <= occMonth) candidate = line;
    else break;
  }
  return candidate;
}

export function computeLoanState(loan: Loan, asOfDate?: string): LoanState {
  const asOf = asOfDate ?? todayIso();
  const occurrences = loan.occurrencesDetected ?? [];
  const occBeforeDate = occurrences.filter((o) => o.date <= asOf);
  const totalPaid = occBeforeDate.reduce((s, o) => s + Math.abs(o.amount), 0);

  const monthsActive = loan.startDate ? monthsBetween(loan.startDate, asOf) : 0;
  const monthsRemaining = loan.endDate ? monthsBetween(asOf, loan.endDate) : null;

  let plannedFromSchedule: number | null = null;
  if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
    const asOfMonth = monthOf(asOf);
    const line = findScheduleLineForMonth(loan.amortizationSchedule, asOfMonth);
    plannedFromSchedule = line ? line.capitalRemaining : loan.amortizationSchedule[0].capitalRemaining;
  }

  let estimatedFromOccurrences: number | null = null;
  if (loan.initialPrincipal != null && loan.initialPrincipal > 0) {
    if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
      let cumulCapitalPaid = 0;
      const seenMonths = new Set<string>();
      for (const occ of occBeforeDate) {
        const m = monthOf(occ.date);
        if (seenMonths.has(m)) continue;
        seenMonths.add(m);
        const line = findScheduleLineForMonth(loan.amortizationSchedule, m);
        if (line) cumulCapitalPaid += line.capitalPaid;
      }
      estimatedFromOccurrences = Math.max(0, loan.initialPrincipal - cumulCapitalPaid);
    } else {
      estimatedFromOccurrences = Math.max(0, loan.initialPrincipal - totalPaid);
    }
  }

  const gap =
    plannedFromSchedule != null && estimatedFromOccurrences != null
      ? Math.round((plannedFromSchedule - estimatedFromOccurrences) * 100) / 100
      : null;

  return {
    asOfDate: asOf,
    capitalRemaining: { plannedFromSchedule, estimatedFromOccurrences, gap },
    totalPaid: Math.round(totalPaid * 100) / 100,
    occurrencesCount: occurrences.length,
    monthsActive,
    monthsRemaining,
  };
}
