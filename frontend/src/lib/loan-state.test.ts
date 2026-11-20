import { describe, expect, it } from 'vitest';
import type { AmortizationLine, Loan, LoanOccurrence } from '@/types/api';
import { computeLoanState, matchDebitsToSchedule } from './loan-state';

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'l-1',
    name: 'Test loan',
    type: 'classic',
    category: 'consumer',
    monthlyPayment: 300,
    matchPattern: 'TEST',
    isActive: true,
    occurrencesDetected: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function occ(date: string, amount: number, id = date): LoanOccurrence {
  return { id, statementId: 'stmt', date, amount, transactionId: null };
}

function sched(date: string, capitalRemaining: number, capitalPaid: number): AmortizationLine {
  return { date, capitalRemaining, capitalPaid, interestPaid: 0 };
}

describe('computeLoanState — baseline', () => {
  it('all capitalRemaining fields are null for a bare loan (no schedule, no principal)', () => {
    const state = computeLoanState(makeLoan(), '2026-05-01');
    expect(state.capitalRemaining.plannedFromSchedule).toBeNull();
    expect(state.capitalRemaining.estimatedFromOccurrences).toBeNull();
    expect(state.capitalRemaining.gap).toBeNull();
  });

  it('returns totalPaid=0 and occurrencesCount=0 for an empty loan', () => {
    const state = computeLoanState(makeLoan(), '2026-05-01');
    expect(state.totalPaid).toBe(0);
    expect(state.occurrencesCount).toBe(0);
  });

  it('echoes the provided asOfDate verbatim', () => {
    expect(computeLoanState(makeLoan(), '2025-12-31').asOfDate).toBe('2025-12-31');
  });
});

describe('computeLoanState — totalPaid and occurrencesCount', () => {
  it('accumulates absolute values — negative debit amounts are treated as positive', () => {
    const loan = makeLoan({
      occurrencesDetected: [occ('2026-01-15', -300), occ('2026-02-15', -310.5)],
    });
    expect(computeLoanState(loan, '2026-03-01').totalPaid).toBeCloseTo(610.5, 5);
  });

  it('excludes occurrences strictly after asOfDate', () => {
    const loan = makeLoan({
      occurrencesDetected: [occ('2026-01-15', -300), occ('2026-06-15', -300)],
    });
    expect(computeLoanState(loan, '2026-05-01').totalPaid).toBe(300);
  });

  it('occurrencesCount = full array length, not the date-filtered subset', () => {
    const loan = makeLoan({
      occurrencesDetected: [occ('2026-01-15', -300), occ('2026-06-15', -300)],
    });
    expect(computeLoanState(loan, '2026-05-01').occurrencesCount).toBe(2);
  });
});

describe('computeLoanState — monthsActive / monthsRemaining', () => {
  it('monthsActive = 0 when startDate and asOf are in the same calendar month', () => {
    expect(
      computeLoanState(makeLoan({ startDate: '2026-05-01' }), '2026-05-20').monthsActive,
    ).toBe(0);
  });

  it('monthsActive counts full months elapsed, crossing a year boundary correctly', () => {
    expect(
      computeLoanState(makeLoan({ startDate: '2025-11-01' }), '2026-02-01').monthsActive,
    ).toBe(3);
  });

  it('monthsRemaining is null when no endDate is set', () => {
    expect(computeLoanState(makeLoan(), '2026-05-01').monthsRemaining).toBeNull();
  });

  it('monthsRemaining = 0 when endDate is in the past relative to asOf', () => {
    expect(
      computeLoanState(makeLoan({ endDate: '2026-04-01' }), '2026-05-01').monthsRemaining,
    ).toBe(0);
  });
});

describe('computeLoanState — plannedFromSchedule', () => {
  const schedule = [
    sched('2026-01-01', 9800, 200),
    sched('2026-02-01', 9598, 202),
    sched('2026-03-01', 9394, 204),
  ];

  it('returns the capitalRemaining of the latest schedule line at or before asOf month', () => {
    const state = computeLoanState(makeLoan({ amortizationSchedule: schedule }), '2026-02-15');
    expect(state.capitalRemaining.plannedFromSchedule).toBe(9598);
  });

  it('uses the last schedule entry when asOf is past the end of the schedule', () => {
    const state = computeLoanState(makeLoan({ amortizationSchedule: schedule }), '2026-12-01');
    expect(state.capitalRemaining.plannedFromSchedule).toBe(9394);
  });

  it('falls back to schedule[0].capitalRemaining when asOf predates the entire schedule', () => {
    const state = computeLoanState(makeLoan({ amortizationSchedule: schedule }), '2025-12-01');
    expect(state.capitalRemaining.plannedFromSchedule).toBe(9800);
  });
});

describe('computeLoanState — estimatedFromOccurrences (no amortization schedule)', () => {
  it('estimated = initialPrincipal − totalPaid (simple path without schedule)', () => {
    const loan = makeLoan({
      initialPrincipal: 5000,
      occurrencesDetected: [occ('2026-01-15', -300), occ('2026-02-15', -300)],
    });
    expect(computeLoanState(loan, '2026-03-01').capitalRemaining.estimatedFromOccurrences).toBe(4400);
  });

  it('clamps to 0 — estimated capital never goes negative (overpaid scenario)', () => {
    const loan = makeLoan({
      initialPrincipal: 500,
      occurrencesDetected: [occ('2026-01-15', -600)],
    });
    expect(computeLoanState(loan, '2026-03-01').capitalRemaining.estimatedFromOccurrences).toBe(0);
  });

  it('returns null when initialPrincipal is absent', () => {
    const loan = makeLoan({ occurrencesDetected: [occ('2026-01-15', -300)] });
    expect(computeLoanState(loan, '2026-03-01').capitalRemaining.estimatedFromOccurrences).toBeNull();
  });
});

describe('computeLoanState — estimatedFromOccurrences + gap (with schedule)', () => {
  const schedule = [
    sched('2026-01-01', 9800, 200),
    sched('2026-02-01', 9598, 202),
    sched('2026-03-01', 9394, 204),
  ];

  it('uses schedule capitalPaid per month, not raw occurrence amounts', () => {
    const loan = makeLoan({
      initialPrincipal: 10000,
      amortizationSchedule: schedule,
      occurrencesDetected: [occ('2026-01-15', -312), occ('2026-02-10', -314)],
    });
    const state = computeLoanState(loan, '2026-02-28');
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(9598);
  });

  it('deux prélèvements dans un mois, mois voisins déjà prélevés : le second n’est pas rattaché (L180, D-1, revue)', () => {
    const loan = makeLoan({
      initialPrincipal: 10000,
      amortizationSchedule: schedule,
      occurrencesDetected: [
        occ('2026-01-10', -312, 'occ-a'),
        occ('2026-01-25', -312, 'occ-b'),
        occ('2026-02-10', -314, 'occ-c'),
      ],
    });
    const state = computeLoanState(loan, '2026-02-28');
    // Le 25 janvier ne glisse pas en février : février a son propre prélèvement
    // (le décaler repousserait toute la suite d'une échéance). Janvier et
    // février comptent une fois chacun : 10000 − 200 − 202.
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(9598);
    expect(matchDebitsToSchedule(loan).map((m) => m.lineIndex)).toEqual([0, null, 1]);
  });

  it('gap is negative when a payment month is skipped (behind schedule)', () => {
    const loan = makeLoan({
      initialPrincipal: 10000,
      amortizationSchedule: schedule,
      occurrencesDetected: [
        occ('2026-01-15', -312, 'jan'),
        occ('2026-03-15', -316, 'mar'),
      ],
    });
    const state = computeLoanState(loan, '2026-03-31');
    expect(state.capitalRemaining.gap).toBe(-202);
  });

  it('gap is null when plannedFromSchedule is null (no schedule)', () => {
    const loan = makeLoan({ initialPrincipal: 5000 });
    expect(computeLoanState(loan, '2026-05-01').capitalRemaining.gap).toBeNull();
  });
  it('un remboursement anticipé est imputé à 100 % en capital, en plus de la ligne du schedule du mois', () => {
    const loan = makeLoan({
      initialPrincipal: 10000,
      amortizationSchedule: [sched('2026-01-05', 9800, 200), sched('2026-02-05', 9600, 200)],
      occurrencesDetected: [
        occ('2026-01-05', -240),
        { ...occ('2026-01-20', -5000), source: 'early_repayment' },
      ],
    });
    const state = computeLoanState(loan, '2026-01-31');
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(4800);
  });
});

describe('matchDebitsToSchedule — prélèvements décalés (L180, D-1)', () => {
  // Échéances le 5 de chaque mois, de janvier à juin.
  const schedule = ['01', '02', '03', '04', '05', '06'].map((m, i) => sched(`2026-${m}-05`, 6000 - 1000 * (i + 1), 1000));
  const loanWith = (dates: string[]) =>
    makeLoan({ initialPrincipal: 6000, amortizationSchedule: schedule, occurrencesDetected: dates.map((d) => occ(d, -1050)) });
  const slots = (dates: string[]) =>
    matchDebitsToSchedule(loanWith(dates)).map((m) => (m.lineIndex == null ? null : schedule[m.lineIndex].date.slice(0, 7)));

  it('chaque prélèvement dans son mois : aucun décalage', () => {
    expect(slots(['2026-01-06', '2026-02-04', '2026-03-05'])).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('février prélevé le 2 mars : rattaché à février, mars garde le sien', () => {
    expect(slots(['2026-01-05', '2026-03-02', '2026-03-30', '2026-04-05'])).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('mars prélevé en avance le 27 février : février garde le sien, mars reçoit l’avance', () => {
    expect(slots(['2026-01-05', '2026-02-05', '2026-02-27', '2026-04-05'])).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('décalages en chaîne (deux mois chargés puis un mois vide) : tout est rattaché', () => {
    expect(slots(['2026-01-05', '2026-03-01', '2026-03-31', '2026-04-30'])).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('un vrai trou reste un trou : on ne décale pas sans prélèvement en trop', () => {
    expect(slots(['2026-01-05', '2026-03-05', '2026-04-05'])).toEqual(['2026-01', '2026-03', '2026-04']);
  });

  it('un prélèvement sans échéance libre à ± 1 mois n’est pas rattaché (jamais deux fois la même échéance)', () => {
    const dates = ['2026-01-05', '2026-02-05', '2026-02-20', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];
    expect(slots(dates)).toEqual(['2026-01', '2026-02', null, '2026-03', '2026-04', '2026-05', '2026-06']);
    // Sept prélèvements, six échéances : le capital ne descend pas sous zéro, aucune échéance comptée deux fois.
    expect(computeLoanState(loanWith(dates), '2026-12-31').capitalRemaining.estimatedFromOccurrences).toBe(0);
  });

  it('débit en trop au MILIEU du tableau : non rattaché, la suite garde chacun son mois (revue L180)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      sched(`2026-${String(i + 1).padStart(2, '0')}-05`, 12000 - 1000 * (i + 1), 1000),
    );
    const dates = ['2026-01-05', '2026-02-05', '2026-02-20', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];
    const loan = makeLoan({ initialPrincipal: 12000, amortizationSchedule: twelve, occurrencesDetected: dates.map((d) => occ(d, -1050, d)) });
    const months = matchDebitsToSchedule(loan).map((m) => (m.lineIndex == null ? null : twelve[m.lineIndex].date.slice(0, 7)));
    expect(months).toEqual(['2026-01', '2026-02', null, '2026-03', '2026-04', '2026-05', '2026-06']);
    // Six échéances payées (janvier → juin), pas sept : juillet n'est pas payé.
    expect(computeLoanState(loan, '2026-12-31').capitalRemaining.estimatedFromOccurrences).toBe(6000);
  });

  it('jamais de chaîne de décalages pour rattacher un prélèvement de plus', () => {
    // Le 25 janvier ne peut glisser qu'en février, qui a déjà le sien : il reste
    // non rattaché, au lieu de pousser février en mars et mars en avril.
    expect(slots(['2026-01-05', '2026-01-25', '2026-02-05', '2026-03-05'])).toEqual(['2026-01', null, '2026-02', '2026-03']);
  });

  it('dernière échéance payée en avance (27 mai pour juin, rien en juin) : rattachée à juin', () => {
    expect(slots(['2026-04-05', '2026-05-05', '2026-05-27'])).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('dernière échéance prélevée le mois suivant, hors tableau : rattachée à la dernière échéance', () => {
    expect(slots(['2026-04-05', '2026-05-05', '2026-07-02'])).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('remboursement anticipé seul en février, février prélevé le 2 mars : la mensualité décalée va à février (L181)', () => {
    const loan = makeLoan({
      initialPrincipal: 6000,
      amortizationSchedule: schedule,
      occurrencesDetected: [
        occ('2026-01-05', -1050),
        { ...occ('2026-02-15', -500), source: 'early_repayment' },
        occ('2026-03-02', -1050),
        occ('2026-03-30', -1050),
        occ('2026-04-05', -1050),
      ],
    });
    const months = matchDebitsToSchedule(loan).map((m) => (m.lineIndex == null ? null : schedule[m.lineIndex].date.slice(0, 7)));
    // L'anticipé n'est pas une mensualité : il n'est pas apparié et ne bloque pas février.
    expect(months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    const state = computeLoanState(loan, '2026-04-30');
    // 4 échéances × 1 000 € + 500 € d'anticipé = 4 500 € de capital remboursé.
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(1500);
    expect(state.totalPaid).toBe(4 * 1050 + 500);
  });

  it('un mois avec une mensualité ET un anticipé reste pris : pas de décalage vers lui (L181)', () => {
    const loan = makeLoan({
      initialPrincipal: 6000,
      amortizationSchedule: schedule,
      occurrencesDetected: [
        occ('2026-01-05', -1050),
        occ('2026-01-25', -1050),
        occ('2026-02-05', -1050),
        { ...occ('2026-02-15', -500), source: 'early_repayment' },
        occ('2026-03-05', -1050),
      ],
    });
    // Le 25 janvier ne peut glisser qu'en février, qui a déjà sa mensualité.
    const months = matchDebitsToSchedule(loan).map((m) => (m.lineIndex == null ? null : schedule[m.lineIndex].date.slice(0, 7)));
    expect(months).toEqual(['2026-01', null, '2026-02', '2026-03']);
  });

  it('cohérence : capital estimé = capital initial − part capital des seules échéances rattachées', () => {
    const loan = loanWith(['2026-01-05', '2026-03-02', '2026-03-30', '2026-04-05']);
    const state = computeLoanState(loan, '2026-04-30');
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(2000);
    expect(state.capitalRemaining.plannedFromSchedule).toBe(2000);
    expect(state.capitalRemaining.gap).toBe(0);
    expect(state.totalPaid).toBe(4 * 1050);
  });
});
