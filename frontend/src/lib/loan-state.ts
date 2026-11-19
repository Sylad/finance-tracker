/**
 * Port frontend du helper `computeLoanState` (backend
 * /backend/src/modules/loans/loans-state.helper.ts).
 *
 * Utilisé par `AmortizationChart` pour le calcul prévu vs réel sans
 * appel HTTP. Garde la même logique pour rester cohérent — toute évolution
 * du calcul doit être faite côté backend ET frontend, surveillée par
 * tests des deux côtés.
 */

import type { Loan, AmortizationLine, LoanOccurrence } from '@/types/api';

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

/** Rang absolu d'un mois (`AAAA-MM…`) : année × 12 + mois. */
function monthRank(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
}

function dayDistance(aIso: string, bIso: string): number {
  return Math.abs(Date.parse(aIso.slice(0, 10) + 'T00:00:00Z') - Date.parse(bIso.slice(0, 10) + 'T00:00:00Z')) / 86_400_000;
}

/** Un prélèvement rattaché (ou non) à une ligne du tableau d'amortissement. */
export interface DebitMatch {
  occurrence: LoanOccurrence;
  /** Indice de la ligne du tableau rattachée, ou null si aucune échéance libre à ± 1 mois. */
  lineIndex: number | null;
}

/**
 * Rattache chaque mensualité prélevée (débit hors remboursement anticipé) à
 * UNE échéance du tableau, et chaque échéance à un prélèvement au plus (L180,
 * règle de Sylvain D-1 : « chaque virement retiré une fois au crédit ; les
 * retards, c'est que les débits ne se font pas toujours à la même date, on
 * peut les décaler »).
 *
 * Appariement ordonné (le n-ième prélèvement ne passe jamais avant le
 * (n−1)-ième), chaque prélèvement restant dans son mois ou glissant au mois
 * voisin (± 1 mois). Parmi les appariements possibles : le plus de
 * prélèvements rattachés, puis le moins de décalages, puis les dates les
 * plus proches des échéances. Un prélèvement en retard qui tombe dans le mois
 * de l'échéance suivante est donc rattaché au mois resté vide, au lieu d'être
 * écarté ; un vrai trou (aucun prélèvement à rattacher) reste un trou.
 * Un prélèvement sans échéance libre à ± 1 mois reste non rattaché
 * (`lineIndex: null`) : il compte dans le total prélevé, pas dans le capital.
 *
 * Miroir exact de `matchDebitsToSchedule` côté backend (loans-state.helper.ts).
 */
export function matchDebitsToSchedule(loan: Pick<Loan, 'occurrencesDetected' | 'amortizationSchedule'>): DebitMatch[] {
  const debits = (loan.occurrencesDetected ?? [])
    .filter((o) => o.amount < 0 && o.source !== 'early_repayment')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lines = (loan.amortizationSchedule ?? []).map((line, index) => ({ line, index }));
  lines.sort((a, b) => a.line.date.localeCompare(b.line.date) || a.index - b.index);
  const n = debits.length;
  const m = lines.length;
  if (n === 0) return [];
  if (m === 0) return debits.map((occurrence) => ({ occurrence, lineIndex: null }));

  // Score d'un préfixe : [rattachés, décalages, jours d'écart] — on maximise
  // le premier, puis on minimise les deux autres.
  type Score = [number, number, number];
  const better = (a: Score, b: Score) =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2] - 1e-9;
  const score: Score[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => [0, 0, 0] as Score));
  // 0 = prélèvement i non rattaché, 1 = échéance j sans prélèvement, 2 = i ↔ j.
  const move: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best: Score | null = null;
      let how = 0;
      if (i > 0) {
        best = score[i - 1][j];
        how = 0;
      }
      if (j > 0 && (best == null || better(score[i][j - 1], best))) {
        best = score[i][j - 1];
        how = 1;
      }
      if (i > 0 && j > 0) {
        const d = debits[i - 1];
        const l = lines[j - 1].line;
        const shift = Math.abs(monthRank(d.date) - monthRank(l.date));
        if (shift <= 1) {
          const prev = score[i - 1][j - 1];
          const cand: Score = [prev[0] + 1, prev[1] + shift, prev[2] + dayDistance(d.date, l.date)];
          if (best == null || better(cand, best)) {
            best = cand;
            how = 2;
          }
        }
      }
      score[i][j] = best!;
      move[i][j] = how;
    }
  }

  const lineOf = new Array<number | null>(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const how = move[i][j];
    if (i > 0 && (j === 0 || how === 0)) i--;
    else if (how === 1) j--;
    else {
      lineOf[i - 1] = lines[j - 1].index;
      i--;
      j--;
    }
  }
  return debits.map((occurrence, k) => ({ occurrence, lineIndex: lineOf[k] }));
}

export function computeLoanState(loan: Loan, asOfDate?: string): LoanState {
  const asOf = asOfDate ?? todayIso();
  const occurrences = loan.occurrencesDetected ?? [];
  const occBeforeDate = occurrences.filter((o) => o.date <= asOf);
  // Débits only : les tirages (amount > 0) sont de la dette ajoutée.
  const totalPaid = occBeforeDate.filter((o) => o.amount < 0).reduce((s, o) => s + Math.abs(o.amount), 0);

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
      const schedule = loan.amortizationSchedule;
      let cumulCapitalPaid = 0;
      // Remboursement anticipé : 100 % capital, hors alignement schedule.
      for (const occ of occBeforeDate) {
        if (occ.source === 'early_repayment' && occ.amount < 0) cumulCapitalPaid += Math.abs(occ.amount);
      }
      // Mensualités : chaque prélèvement ≤ asOf compte la part capital de
      // l'échéance qui lui est rattachée, une fois et une seule (L180).
      for (const { occurrence, lineIndex } of matchDebitsToSchedule(loan)) {
        if (lineIndex != null && occurrence.date <= asOf) cumulCapitalPaid += schedule[lineIndex].capitalPaid;
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
