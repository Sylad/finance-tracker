import type { Loan } from '@/types/api';
import { matchDebitsToSchedule } from './loan-state';

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
   * mois : capital initial − part capital des échéances payées jusqu'à ce
   * mois (chaque prélèvement rattaché à UNE échéance, L180) − remboursements
   * anticipés. `null` pour tout mois sans prélèvement (L177) : avant le
   * premier, après le dernier et dans les trous — la courbe ne prolonge
   * jamais une valeur au-delà de ce que l'on sait, et l'infobulle n'en
   * invente pas.
   */
  reel: number | null;
  /**
   * Mois d'échéance sans prélèvement trouvé ENTRE le premier et le dernier
   * prélèvement connus (L178) : la courbe Réel s'interrompt là, et
   * l'infobulle dit qu'aucun prélèvement n'a été trouvé. Un prélèvement
   * décalé rattaché à ce mois (L180) n'en fait plus un trou.
   */
  missing: boolean;
  /** Mois (`YYYY-MM`) où a été prélevée l'échéance de ce mois, quand c'est un autre mois (L180). */
  paidIn: string[];
  /** Mois (`YYYY-MM`) des échéances auxquelles sont rattachés les prélèvements faits ce mois-ci dans un autre mois (L180). */
  countedFor: string[];
}

export interface AmortizationSeries {
  points: AmortizationPoint[];
  /** Mois (`YYYY-MM`) du dernier prélèvement placé sur la courbe, ou null. */
  lastKnownMonth: string | null;
  /**
   * Mensualités prélevées sans échéance libre à ± 1 mois (L180) : comptées
   * dans le total prélevé, pas dans le capital estimé. La phrase le dit.
   */
  unmatchedCount: number;
}

const monthOf = (iso: string) => iso.slice(0, 7);

export function buildAmortizationSeries(loan: Loan): AmortizationSeries {
  const schedule = loan.amortizationSchedule ?? [];
  if (schedule.length === 0) return { points: [], lastKnownMonth: null, unmatchedCount: 0 };

  // Capital prévu de la DERNIÈRE ligne de chaque mois d'échéance.
  const plannedByMonth = new Map<string, number>();
  for (const line of schedule) plannedByMonth.set(monthOf(line.date), line.capitalRemaining);

  // L180 : chaque prélèvement est rattaché à une échéance (son mois, ou le
  // mois voisin resté vide quand la date a glissé), une fois et une seule.
  const matches = matchDebitsToSchedule(loan);
  const paid = matches
    .filter((m) => m.lineIndex != null)
    .map((m) => ({
      slotMonth: monthOf(schedule[m.lineIndex!].date),
      debitMonth: monthOf(m.occurrence.date),
      capital: schedule[m.lineIndex!].capitalPaid,
    }));
  const early = (loan.occurrencesDetected ?? [])
    .filter((o) => o.amount < 0 && o.source === 'early_repayment')
    .map((o) => ({ month: monthOf(o.date), amount: Math.abs(o.amount) }));

  // Mois qui portent un prélèvement (mensualité, rattachée ou non, ou anticipé).
  const debitMonths = new Set<string>();
  for (const o of loan.occurrencesDetected ?? []) if (o.amount < 0) debitMonths.add(monthOf(o.date));
  const matchedSlots = new Set(paid.map((p) => p.slotMonth));

  // L178 : un prélèvement tombé dans un mois sans échéance (échéance payée en
  // retard, après la dernière ligne…) a lui aussi son point, sinon la courbe
  // et la phrase s'arrêtent un mois trop tôt.
  const months = [...new Set([...plannedByMonth.keys(), ...debitMonths])].sort();

  const principal = loan.initialPrincipal != null && loan.initialPrincipal > 0 ? loan.initialPrincipal : null;

  let lastPlanned: number | null = null;
  let lastKnownMonth: string | null = null;
  let firstKnownMonth: string | null = null;

  const points: AmortizationPoint[] = [];
  for (const month of months) {
    const scheduled = plannedByMonth.has(month);
    if (scheduled) lastPlanned = plannedByMonth.get(month)!;
    let reel: number | null = null;
    // Un mois d'échéance est connu s'il a son prélèvement (le sien ou un
    // décalé) ; tout mois où un prélèvement a eu lieu l'est aussi.
    const known = (scheduled && matchedSlots.has(month)) || debitMonths.has(month);
    if (principal != null && known) {
      // Mois d'échéance : les échéances jusqu'à ce mois. Mois sans échéance :
      // s'y ajoutent les prélèvements faits ce mois-ci (rattachés à une
      // échéance suivante), pour que le point dise l'argent déjà versé.
      const counts = (p: (typeof paid)[number]) => p.slotMonth <= month || (!scheduled && p.debitMonth <= month);
      const capitalPaid =
        paid.filter(counts).reduce((s, p) => s + p.capital, 0) +
        early.filter((e) => e.month <= month).reduce((s, e) => s + e.amount, 0);
      reel = Math.round(Math.max(0, principal - capitalPaid));
      lastKnownMonth = month;
      firstKnownMonth ??= month;
    }
    points.push({
      month,
      prevu: lastPlanned == null ? null : Math.round(lastPlanned),
      scheduled,
      reel,
      missing: false,
      paidIn: [...new Set(paid.filter((p) => p.slotMonth === month && p.debitMonth !== month).map((p) => p.debitMonth))],
      countedFor: [...new Set(paid.filter((p) => p.debitMonth === month && p.slotMonth !== month).map((p) => p.slotMonth))],
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

  return { points, lastKnownMonth, unmatchedCount: matches.filter((m) => m.lineIndex == null).length };
}
