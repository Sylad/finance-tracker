import type { Loan } from '@/types/api';
import { computeLoanState } from './loan-state';

export interface AmortizationPoint {
  /** Mois du point, `YYYY-MM` : un mois d'échéance, ou un mois de prélèvement sans échéance (L178). */
  month: string;
  /**
   * Capital restant prévu par le tableau d'amortissement à la fin du mois :
   * celui de la dernière échéance ≤ ce mois (un mois sans échéance garde le
   * capital de la précédente). `null` avant la première échéance.
   */
  prevu: number | null;
  /** `false` quand le mois n'a pas d'échéance au tableau (point ajouté pour un prélèvement, L178). */
  scheduled: boolean;
  /**
   * Capital restant estimé d'après les prélèvements détectés, à la fin du
   * mois. `null` pour tout mois sans prélèvement (L177) : avant le premier,
   * après le dernier et dans les trous — la courbe ne prolonge jamais une
   * valeur au-delà de ce que l'on sait, et l'infobulle n'en invente pas.
   */
  reel: number | null;
  /**
   * Mois d'échéance sans prélèvement trouvé ENTRE le premier et le dernier
   * prélèvement connus (L178) : la courbe Réel s'interrompt là, et
   * l'infobulle dit qu'aucun prélèvement n'a été trouvé.
   */
  missing: boolean;
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
  if (schedule.length === 0) return { points: [], lastKnownMonth: null };

  // Capital prévu de la DERNIÈRE ligne de chaque mois d'échéance.
  const plannedByMonth = new Map<string, number>();
  for (const line of schedule) plannedByMonth.set(line.date.slice(0, 7), line.capitalRemaining);

  const debits = debitMonths(loan);
  // L178 : un prélèvement tombé dans un mois sans échéance (échéance payée en
  // retard, après la dernière ligne…) a lui aussi son point, sinon la courbe
  // et la phrase s'arrêtent un mois trop tôt.
  const months = [...new Set([...plannedByMonth.keys(), ...debits])].sort();

  let lastPlanned: number | null = null;
  let lastKnownMonth: string | null = null;
  let firstKnownMonth: string | null = null;

  const points: AmortizationPoint[] = [];
  for (const month of months) {
    const scheduled = plannedByMonth.has(month);
    if (scheduled) lastPlanned = plannedByMonth.get(month)!;
    let reel: number | null = null;
    if (debits.has(month)) {
      // État à la fin du mois : le prélèvement du mois compte même s'il
      // tombe après la date de l'échéance.
      const estimated = computeLoanState(loan, `${month}-31`).capitalRemaining.estimatedFromOccurrences;
      if (estimated != null) {
        reel = Math.round(estimated);
        lastKnownMonth = month;
        firstKnownMonth ??= month;
      }
    }
    points.push({
      month,
      prevu: lastPlanned == null ? null : Math.round(lastPlanned),
      scheduled,
      reel,
      missing: false,
    });
  }

  // Trous au milieu de la courbe : échéance sans prélèvement, entre le
  // premier et le dernier prélèvement connus.
  if (firstKnownMonth != null && lastKnownMonth != null) {
    for (const p of points) {
      if (p.scheduled && p.reel == null && p.month > firstKnownMonth && p.month < lastKnownMonth) {
        p.missing = true;
      }
    }
  }

  return { points, lastKnownMonth };
}
