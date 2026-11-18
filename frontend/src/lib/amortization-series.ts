import type { Loan } from '@/types/api';
import { computeLoanState } from './loan-state';

export interface AmortizationPoint {
  /** Mois de l'échéance, `YYYY-MM`. */
  month: string;
  /** Capital restant prévu par le tableau d'amortissement. */
  prevu: number;
  /**
   * Capital restant estimé d'après les prélèvements détectés, à la fin du
   * mois. `null` pour tout mois sans prélèvement (L177) : avant le premier,
   * après le dernier et dans les trous — la courbe ne prolonge jamais une
   * valeur au-delà de ce que l'on sait, et l'infobulle n'en invente pas.
   */
  reel: number | null;
}

export interface AmortizationSeries {
  points: AmortizationPoint[];
  /** Mois (`YYYY-MM`) du dernier prélèvement placé sur la courbe, ou null. */
  lastKnownMonth: string | null;
}

/** Mois qui portent au moins un débit détecté (mensualité ou anticipé). */
function debitMonths(loan: Loan): Set<string> {
  const months = new Set<string>();
  for (const o of loan.occurrencesDetected ?? []) {
    if (o.amount < 0) months.add(o.date.slice(0, 7));
  }
  return months;
}

export function buildAmortizationSeries(loan: Loan): AmortizationSeries {
  const schedule = loan.amortizationSchedule ?? [];
  const months = debitMonths(loan);
  let lastKnownMonth: string | null = null;

  const points = schedule.map((line) => {
    const month = line.date.slice(0, 7);
    let reel: number | null = null;
    if (months.has(month)) {
      // État à la fin du mois : le prélèvement du mois compte même s'il
      // tombe après la date de l'échéance.
      const estimated = computeLoanState(loan, `${month}-31`).capitalRemaining.estimatedFromOccurrences;
      if (estimated != null) {
        reel = Math.round(estimated);
        lastKnownMonth = month;
      }
    }
    return { month, prevu: Math.round(line.capitalRemaining), reel };
  });

  return { points, lastKnownMonth };
}
