import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AmortizationLine, Loan, LoanOccurrence } from '@/types/api';
import { buildAmortizationSeries } from '@/lib/amortization-series';
import { AmortizationChart } from './amortization-chart';

function line(date: string, capitalRemaining: number, capitalPaid: number): AmortizationLine {
  return { date, capitalRemaining, capitalPaid, interestPaid: 0 };
}

function occ(date: string, amount: number): LoanOccurrence {
  return { id: date, statementId: 's', date, amount, transactionId: null };
}

/** 6 échéances de 1 000 € de capital, prélèvements connus de janvier à mars (février manquant). */
function loan(occurrences: LoanOccurrence[]): Loan {
  return {
    id: 'cetelem',
    name: 'CETELEM auto',
    type: 'classic',
    category: 'consumer',
    monthlyPayment: 1050,
    matchPattern: 'CETELEM',
    isActive: true,
    initialPrincipal: 6000,
    amortizationSchedule: [
      line('2026-01-05', 5000, 1000),
      line('2026-02-05', 4000, 1000),
      line('2026-03-05', 3000, 1000),
      line('2026-04-05', 2000, 1000),
      line('2026-05-05', 1000, 1000),
      line('2026-06-05', 0, 1000),
    ],
    occurrencesDetected: occurrences,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Loan;
}

describe('Graphique d’amortissement — courbe Réel (estimé) (L177)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  it('la courbe Réel s’arrête au dernier prélèvement connu, pas à la fin du crédit', () => {
    const { points, lastKnownMonth } = buildAmortizationSeries(
      loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050)]),
    );
    expect(lastKnownMonth).toBe('2026-03');
    // Après mars : aucune valeur, au lieu d'un plat à 4 000 € jusqu'en juin.
    expect(points.slice(3).map((p) => p.reel)).toEqual([null, null, null]);
    // La courbe Prévu, elle, va jusqu'au bout.
    expect(points.map((p) => p.prevu)).toEqual([5000, 4000, 3000, 2000, 1000, 0]);
  });

  it('un mois sans prélèvement n’a pas de valeur Réel (l’infobulle n’en invente pas)', () => {
    const { points } = buildAmortizationSeries(loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050)]));
    expect(points[0].reel).toBe(5000);
    expect(points[1].reel).toBeNull(); // février : aucun prélèvement détecté
    expect(points[2].reel).toBe(4000);
  });

  it('le prélèvement du mois compte même s’il tombe après la date d’échéance', () => {
    const { points } = buildAmortizationSeries(loan([occ('2026-01-20', -1050)]));
    expect(points[0].reel).toBe(5000);
  });

  it('un virement entrant (tirage) ne crée pas de point Réel', () => {
    const { points, lastKnownMonth } = buildAmortizationSeries(loan([occ('2026-02-10', 500)]));
    expect(points.every((p) => p.reel === null)).toBe(true);
    expect(lastKnownMonth).toBeNull();
  });

  it('le graphique déplié dit jusqu’où va la courbe Réel', () => {
    render(<AmortizationChart loan={loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050)])} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, mars 2026.",
    );
  });

  it('sans aucun prélèvement, le graphique le dit au lieu d’une courbe vide muette', () => {
    render(<AmortizationChart loan={loan([])} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toBe(
      'Réel (estimé) : aucun prélèvement détecté pour ce crédit.',
    );
  });
});
