import type {
  Loan,
  AmortizationLine,
  LoanOccurrence,
} from '../../models/loan.model';
import { monthKey } from '../../common/month-key';

/**
 * État calculé d'un Loan à une date donnée. Le suivi du capital restant
 * est crucial pour les crédits classiques : combien la banque attend
 * (planned, depuis le tableau d'amortissement) vs combien on a réellement
 * remboursé (estimated, depuis les occurrences détectées).
 */
export interface LoanState {
  asOfDate: string; // YYYY-MM-DD

  capitalRemaining: {
    /** Capital restant prévu par le tableau d'amortissement à asOfDate.
     *  null si pas de schedule disponible. */
    plannedFromSchedule: number | null;

    /** Capital restant estimé depuis les occurrences détectées en alignant
     *  chaque occurrence sur la portion `capitalPaid` de la même ligne du
     *  schedule. Plus précis que initialPrincipal - sum(amount) car ce
     *  dernier soustrait aussi les intérêts.
     *  null si pas d'initialPrincipal connu. */
    estimatedFromOccurrences: number | null;

    /** Différence (planned − estimated). Positif = on est en retard, négatif
     *  = on est en avance (remboursement anticipé). null si l'un manque. */
    gap: number | null;
  };

  /** Somme des |amount| de toutes les occurrences à asOfDate. */
  totalPaid: number;

  /** Nombre d'occurrences détectées (toutes sources confondues, déjà dédupées). */
  occurrencesCount: number;

  /** Nombre de mois écoulés depuis startDate jusqu'à asOfDate. */
  monthsActive: number;

  /** Nombre de mois restants entre asOfDate et endDate. null si pas d'endDate. */
  monthsRemaining: number | null;
}

/** Default to today (UTC). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Diff in whole months between two ISO dates (a ≤ b). Returns ≥ 0. */
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
  return monthKey(iso); // YYYY-MM
}

/**
 * Trouve la ligne du schedule correspondant au mois (YYYY-MM) d'une
 * occurrence. Retourne la dernière ligne ≤ ce mois (cas où l'occurrence
 * tombe entre 2 lignes — ex : le user a payé en avance).
 */
function findScheduleLineForMonth(
  schedule: AmortizationLine[],
  occMonth: string,
): AmortizationLine | null {
  let candidate: AmortizationLine | null = null;
  for (const line of schedule) {
    if (monthOf(line.date) <= occMonth) {
      candidate = line;
    } else {
      break; // schedule trié, on peut sortir
    }
  }
  return candidate;
}

/** Rang absolu d'un mois (`AAAA-MM…`) : année × 12 + mois. */
function monthRank(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
}

function dayDistance(aIso: string, bIso: string): number {
  return (
    Math.abs(
      Date.parse(aIso.slice(0, 10) + 'T00:00:00Z') -
        Date.parse(bIso.slice(0, 10) + 'T00:00:00Z'),
    ) / 86_400_000
  );
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
 * (n−1)-ième). Un prélèvement est rattaché à l'échéance de SON mois, ou —
 * décalé — à celle d'un mois voisin (± 1 mois) qui n'a AUCUNE mensualité
 * prélevée (revue L180 ; un remboursement anticipé ne compte pas, L181). Un mois voisin déjà prélevé n'est jamais pris : un débit en
 * trop (doublon, régularisation) ne pousse pas les échéances suivantes d'un
 * mois, il n'y a donc jamais de chaîne de décalages. Parmi les appariements
 * permis : le plus de prélèvements rattachés, puis le moins de décalages,
 * puis les dates les plus proches des échéances. Un prélèvement en retard
 * qui tombe dans le mois de l'échéance suivante est rattaché au mois resté
 * vide ; un vrai trou (aucun prélèvement à rattacher) reste un trou.
 * Un prélèvement sans échéance permise reste non rattaché (`lineIndex:
 * null`) : il compte une fois dans le total prélevé, pas dans le capital.
 *
 * Miroir exact de `matchDebitsToSchedule` côté frontend (lib/loan-state.ts).
 */
export function matchDebitsToSchedule(
  loan: Pick<Loan, 'occurrencesDetected' | 'amortizationSchedule'>,
): DebitMatch[] {
  const debits = (loan.occurrencesDetected ?? [])
    .filter((o) => o.amount < 0 && o.source !== 'early_repayment')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lines = (loan.amortizationSchedule ?? []).map((line, index) => ({
    line,
    index,
  }));
  lines.sort(
    (a, b) => a.line.date.localeCompare(b.line.date) || a.index - b.index,
  );
  const n = debits.length;
  const m = lines.length;
  if (n === 0) return [];
  if (m === 0)
    return debits.map((occurrence) => ({ occurrence, lineIndex: null }));
  // Mois qui portent une MENSUALITÉ prélevée : aucun prélèvement décalé n'y est
  // rattaché. Un remboursement anticipé n'est pas une mensualité (100 % capital,
  // hors tableau) : seul dans un mois, il ne prend pas la place de l'échéance,
  // qui reste libre pour la mensualité décalée (L181).
  const debitMonths = new Set(debits.map((o) => o.date.slice(0, 7)));

  // Score d'un préfixe : [rattachés, décalages, jours d'écart] — on maximise
  // le premier, puis on minimise les deux autres.
  type Score = [number, number, number];
  const better = (a: Score, b: Score) =>
    a[0] !== b[0]
      ? a[0] > b[0]
      : a[1] !== b[1]
        ? a[1] < b[1]
        : a[2] < b[2] - 1e-9;
  const score: Score[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => [0, 0, 0] as Score),
  );
  // 0 = prélèvement i non rattaché, 1 = échéance j sans prélèvement, 2 = i ↔ j.
  const move: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
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
        if (
          shift === 0 ||
          (shift === 1 && !debitMonths.has(l.date.slice(0, 7)))
        ) {
          const prev = score[i - 1][j - 1];
          const cand: Score = [
            prev[0] + 1,
            prev[1] + shift,
            prev[2] + dayDistance(d.date, l.date),
          ];
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

/**
 * Calcule l'état d'un Loan à une date donnée. Pure (no I/O), exporté pour
 * réutilisation backend (loans.controller enrich) ET frontend (mirror).
 */
export function computeLoanState(loan: Loan, asOfDate?: string): LoanState {
  const asOf = asOfDate ?? todayIso();
  const occurrences = loan.occurrencesDetected ?? [];

  // Filtrer les occurrences ≤ asOfDate
  const occBeforeDate = occurrences.filter((o) => o.date <= asOf);
  // Débits only : les tirages (amount > 0) sont de la dette ajoutée, pas payée.
  const totalPaid = occBeforeDate
    .filter((o) => o.amount < 0)
    .reduce((s, o) => s + Math.abs(o.amount), 0);

  // Mois actifs (depuis startDate jusqu'à asOfDate, ou 0 si pas de startDate)
  const monthsActive = loan.startDate ? monthsBetween(loan.startDate, asOf) : 0;
  const monthsRemaining = loan.endDate
    ? monthsBetween(asOf, loan.endDate)
    : null;

  // Capital restant — plannedFromSchedule
  let plannedFromSchedule: number | null = null;
  if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
    const asOfMonth = monthOf(asOf);
    const line = findScheduleLineForMonth(loan.amortizationSchedule, asOfMonth);
    plannedFromSchedule = line
      ? line.capitalRemaining
      : loan.amortizationSchedule[0].capitalRemaining;
  }

  // Capital restant — estimatedFromOccurrences (via cumul capitalPaid des lignes
  // schedule alignées sur les occurrences). Si pas de schedule, fallback naïf.
  let estimatedFromOccurrences: number | null = null;
  if (loan.initialPrincipal != null && loan.initialPrincipal > 0) {
    if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
      // Chaque prélèvement ≤ asOf compte la part capital de l'échéance qui
      // lui est rattachée, une fois et une seule (L180, D-1) : un prélèvement
      // décalé d'un mois compte pour le mois voisin resté vide au lieu d'être
      // écarté. Les remboursements anticipés : 100 % capital.
      const schedule = loan.amortizationSchedule;
      let cumulCapitalPaid = 0;
      for (const occ of occBeforeDate) {
        if (occ.source === 'early_repayment' && occ.amount < 0)
          cumulCapitalPaid += Math.abs(occ.amount);
      }
      for (const { occurrence, lineIndex } of matchDebitsToSchedule(loan)) {
        if (lineIndex != null && occurrence.date <= asOf)
          cumulCapitalPaid += schedule[lineIndex].capitalPaid;
      }
      estimatedFromOccurrences = Math.max(
        0,
        loan.initialPrincipal - cumulCapitalPaid,
      );
    } else {
      // Fallback naïf : initialPrincipal - sum(amount). Inclut les intérêts,
      // donc sous-estime le capital restant. Mais pas de meilleur calcul.
      estimatedFromOccurrences = Math.max(0, loan.initialPrincipal - totalPaid);
    }
  }

  const gap =
    plannedFromSchedule != null && estimatedFromOccurrences != null
      ? Math.round((plannedFromSchedule - estimatedFromOccurrences) * 100) / 100
      : null;

  return {
    asOfDate: asOf,
    capitalRemaining: {
      plannedFromSchedule,
      estimatedFromOccurrences,
      gap,
    },
    totalPaid: Math.round(totalPaid * 100) / 100,
    occurrencesCount: occurrences.length,
    monthsActive,
    monthsRemaining,
  };
}

// Export aussi utility pour tests
export const __test = {
  monthsBetween,
  findScheduleLineForMonth,
  monthOf,
  monthRank,
};
