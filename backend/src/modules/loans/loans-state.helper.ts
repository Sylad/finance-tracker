import type { Loan, AmortizationLine, LoanOccurrence } from '../../models/loan.model';

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
  return iso.slice(0, 7); // YYYY-MM
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

/**
 * Calcule l'état d'un Loan à une date donnée. Pure (no I/O), exporté pour
 * réutilisation backend (loans.controller enrich) ET frontend (mirror).
 */
export function computeLoanState(loan: Loan, asOfDate?: string): LoanState {
  const asOf = asOfDate ?? todayIso();
  const occurrences = loan.occurrencesDetected ?? [];

  // Filtrer les occurrences ≤ asOfDate
  const occBeforeDate = occurrences.filter((o) => o.date <= asOf);
  const totalPaid = occBeforeDate.reduce((s, o) => s + Math.abs(o.amount), 0);

  // Mois actifs (depuis startDate jusqu'à asOfDate, ou 0 si pas de startDate)
  const monthsActive = loan.startDate ? monthsBetween(loan.startDate, asOf) : 0;
  const monthsRemaining = loan.endDate ? monthsBetween(asOf, loan.endDate) : null;

  // Capital restant — plannedFromSchedule
  let plannedFromSchedule: number | null = null;
  if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
    const asOfMonth = monthOf(asOf);
    const line = findScheduleLineForMonth(loan.amortizationSchedule, asOfMonth);
    plannedFromSchedule = line ? line.capitalRemaining : loan.amortizationSchedule[0].capitalRemaining;
  }

  // Capital restant — estimatedFromOccurrences (via cumul capitalPaid des lignes
  // schedule alignées sur les occurrences). Si pas de schedule, fallback naïf.
  let estimatedFromOccurrences: number | null = null;
  if (loan.initialPrincipal != null && loan.initialPrincipal > 0) {
    if (loan.amortizationSchedule && loan.amortizationSchedule.length > 0) {
      // Pour chaque occurrence ≤ asOf, prendre la portion capitalPaid de la ligne
      // schedule du même mois. Sum cumul.
      let cumulCapitalPaid = 0;
      const seenMonths = new Set<string>();
      for (const occ of occBeforeDate) {
        const m = monthOf(occ.date);
        if (seenMonths.has(m)) continue; // 1 occurrence par mois grâce dedup, mais sécurité
        seenMonths.add(m);
        const line = findScheduleLineForMonth(loan.amortizationSchedule, m);
        if (line) {
          cumulCapitalPaid += line.capitalPaid;
        } else {
          // occurrence avant le début du schedule (rare) — fallback proportion
          // plus simple : on attribue 100% au capital (sous-estime)
          // Mieux : on ignore ces occurrences (pas dans la fenêtre du schedule).
        }
      }
      estimatedFromOccurrences = Math.max(0, loan.initialPrincipal - cumulCapitalPaid);
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
export const __test = { monthsBetween, findScheduleLineForMonth, monthOf };
