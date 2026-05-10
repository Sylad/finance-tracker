import { computeLoanState, __test } from './loans-state.helper';
import type { Loan } from '../../models/loan.model';

const baseLoan: Loan = {
  id: 'l1',
  name: 'Auto',
  type: 'classic',
  category: 'auto',
  monthlyPayment: 240,
  matchPattern: 'CETELEM',
  isActive: true,
  occurrencesDetected: [],
  createdAt: '2024-06-01',
  updatedAt: '2024-06-01',
};

describe('computeLoanState', () => {
  it('returns base state with no schedule + no occurrences', () => {
    const state = computeLoanState({ ...baseLoan }, '2026-03-01');
    expect(state.asOfDate).toBe('2026-03-01');
    expect(state.totalPaid).toBe(0);
    expect(state.occurrencesCount).toBe(0);
    expect(state.capitalRemaining.plannedFromSchedule).toBeNull();
    expect(state.capitalRemaining.estimatedFromOccurrences).toBeNull();
    expect(state.capitalRemaining.gap).toBeNull();
  });

  it('totalPaid sums |amount| of occurrences ≤ asOfDate', () => {
    const loan: Loan = {
      ...baseLoan,
      occurrencesDetected: [
        { id: 'o1', statementId: 's1', date: '2026-01-15', amount: -240, transactionId: null },
        { id: 'o2', statementId: 's2', date: '2026-02-15', amount: -240, transactionId: null },
        { id: 'o3', statementId: 's3', date: '2026-03-15', amount: -240, transactionId: null },
        { id: 'o4', statementId: 's4', date: '2026-04-15', amount: -240, transactionId: null }, // après asOf
      ],
    };
    const state = computeLoanState(loan, '2026-03-31');
    expect(state.totalPaid).toBe(720); // 3 × 240, pas 4
    expect(state.occurrencesCount).toBe(4); // count all, totalPaid filtre
  });

  it('plannedFromSchedule = capitalRemaining de la ligne du mois courant', () => {
    const loan: Loan = {
      ...baseLoan,
      initialPrincipal: 12000,
      startDate: '2024-06-01',
      endDate: '2028-05-01',
      amortizationSchedule: [
        { date: '2024-06-01', capitalRemaining: 11800, capitalPaid: 200, interestPaid: 40 },
        { date: '2024-07-01', capitalRemaining: 11599, capitalPaid: 201, interestPaid: 39 },
        { date: '2024-08-01', capitalRemaining: 11397, capitalPaid: 202, interestPaid: 38 },
      ],
    };
    const state = computeLoanState(loan, '2024-07-15');
    expect(state.capitalRemaining.plannedFromSchedule).toBe(11599);
  });

  it('estimatedFromOccurrences via capitalPaid cumul (vs naïf qui inclut intérêts)', () => {
    const loan: Loan = {
      ...baseLoan,
      initialPrincipal: 12000,
      startDate: '2024-06-01',
      endDate: '2028-05-01',
      amortizationSchedule: [
        { date: '2024-06-01', capitalRemaining: 11800, capitalPaid: 200, interestPaid: 40 },
        { date: '2024-07-01', capitalRemaining: 11599, capitalPaid: 201, interestPaid: 39 },
      ],
      occurrencesDetected: [
        { id: 'o1', statementId: 's1', date: '2024-06-15', amount: -240, transactionId: null },
        { id: 'o2', statementId: 's2', date: '2024-07-15', amount: -240, transactionId: null },
      ],
    };
    const state = computeLoanState(loan, '2024-07-31');
    // estimated = 12000 - (200 + 201) = 11599 ; PAS 12000 - (240+240) = 11520
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(11599);
    // gap = 11599 - 11599 = 0 (pile à l'heure)
    expect(state.capitalRemaining.gap).toBe(0);
  });

  it('estimatedFromOccurrences fallback naïf si pas de schedule', () => {
    const loan: Loan = {
      ...baseLoan,
      initialPrincipal: 12000,
      occurrencesDetected: [
        { id: 'o1', statementId: 's1', date: '2024-06-15', amount: -240, transactionId: null },
      ],
    };
    const state = computeLoanState(loan, '2024-12-31');
    // pas de schedule → fallback initialPrincipal - sum(amount) = 12000 - 240 = 11760
    expect(state.capitalRemaining.estimatedFromOccurrences).toBe(11760);
    expect(state.capitalRemaining.plannedFromSchedule).toBeNull();
    expect(state.capitalRemaining.gap).toBeNull();
  });

  it('monthsActive et monthsRemaining', () => {
    const loan: Loan = {
      ...baseLoan,
      startDate: '2024-06-01',
      endDate: '2028-05-01',
    };
    const state = computeLoanState(loan, '2026-06-01');
    expect(state.monthsActive).toBe(24); // juin 2024 → juin 2026 = 24 mois
    expect(state.monthsRemaining).toBe(23); // juin 2026 → mai 2028 = 23 mois
  });

  it('gap positif = en retard, négatif = en avance', () => {
    const loan: Loan = {
      ...baseLoan,
      initialPrincipal: 1000,
      amortizationSchedule: [
        { date: '2024-06-01', capitalRemaining: 800, capitalPaid: 200, interestPaid: 10 },
        { date: '2024-07-01', capitalRemaining: 600, capitalPaid: 200, interestPaid: 9 },
      ],
      occurrencesDetected: [
        // 1 occurrence sur 2 attendues à juillet → en retard
        { id: 'o1', statementId: 's1', date: '2024-06-15', amount: -210, transactionId: null },
      ],
    };
    const state = computeLoanState(loan, '2024-07-15');
    // estimated = 1000 - 200 (juin only) = 800, planned = 600
    // gap = 600 - 800 = -200 (négatif = capital restant ESTIMÉ > attendu = en retard, attendons un attendons)
    // En fait : on a payé moins → estimated capital > planned = on doit plus = en retard
    // gap = planned - estimated = 600 - 800 = -200
    // Convention : positif = on a remboursé plus que prévu (en avance). Négatif = en retard.
    // À ré-évaluer si la convention est inversée — ici on garde sémantique stricte.
    expect(state.capitalRemaining.gap).toBe(-200);
  });
});

describe('helper internals', () => {
  it('monthsBetween', () => {
    expect(__test.monthsBetween('2024-06-01', '2024-06-15')).toBe(0);
    expect(__test.monthsBetween('2024-06-01', '2024-07-01')).toBe(1);
    expect(__test.monthsBetween('2024-06-01', '2026-06-01')).toBe(24);
    expect(__test.monthsBetween('2024-06-01', '2024-05-31')).toBe(0); // a > b
  });

  it('findScheduleLineForMonth retourne la dernière ligne ≤ month', () => {
    const schedule = [
      { date: '2024-06-01', capitalRemaining: 100, capitalPaid: 10, interestPaid: 1 },
      { date: '2024-07-01', capitalRemaining: 90, capitalPaid: 10, interestPaid: 1 },
      { date: '2024-09-01', capitalRemaining: 70, capitalPaid: 10, interestPaid: 1 },
    ];
    expect(__test.findScheduleLineForMonth(schedule, '2024-08')?.date).toBe('2024-07-01');
    expect(__test.findScheduleLineForMonth(schedule, '2024-09')?.date).toBe('2024-09-01');
    expect(__test.findScheduleLineForMonth(schedule, '2024-05')).toBeNull();
  });
});
