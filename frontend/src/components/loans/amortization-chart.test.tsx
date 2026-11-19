import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AmortizationLine, Loan, LoanOccurrence } from '@/types/api';
import { buildAmortizationSeries } from '@/lib/amortization-series';
import { AmortizationChart, AmortizationTooltip } from './amortization-chart';

// jsdom ne mesure rien : ResponsiveContainer rendrait un graphique de taille 0,
// sans aucun tracé. On lui donne une taille fixe pour lire les chemins SVG.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  // Sans animation, les points (dot) sont dessinés tout de suite.
  (actual.Line as unknown as { defaultProps: Record<string, unknown> }).defaultProps.isAnimationActive = false;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 600, height: 200 }),
  };
});

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
      // Février manque entre janvier et mars : la phrase le dit aussi (L178).
      "Réel (estimé) : jusqu'au dernier prélèvement connu, mars 2026. Interrompue en février 2026 : aucun prélèvement trouvé ce mois-là.",
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

describe('Graphique d’amortissement — trous et prélèvements hors échéance (L178)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  const avecTrou = () =>
    loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050), occ('2026-04-08', -1050)]);

  function reelPath(container: HTMLElement): string {
    const paths = [...container.querySelectorAll('.recharts-line-curve')] as SVGPathElement[];
    // Deuxième courbe = Réel (estimé) ; la première est Prévu.
    expect(paths).toHaveLength(2);
    return paths[1].getAttribute('d') ?? '';
  }

  it('un mois sans prélèvement entre deux prélèvements est marqué manquant', () => {
    const { points } = buildAmortizationSeries(avecTrou());
    expect(points.map((p) => p.missing)).toEqual([false, true, false, false, false, false]);
  });

  it('la courbe Réel s’interrompt sur le mois manquant au lieu de le traverser', () => {
    const { container } = render(<AmortizationChart loan={avecTrou()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    // Deux segments (janvier seul, puis mars → avril) : deux « M » dans le tracé.
    expect(reelPath(container).match(/M/g)).toHaveLength(2);
    // Janvier (isolé, bord du trou), mars (autre bord) et avril (dernier prélèvement).
    expect(container.querySelectorAll('circle[fill="#10b981"]')).toHaveLength(3);
  });

  it('sans trou, la courbe Réel reste d’un seul tenant', () => {
    const { container } = render(
      <AmortizationChart loan={loan([occ('2026-01-08', -1050), occ('2026-02-08', -1050), occ('2026-03-08', -1050)])} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(reelPath(container).match(/M/g)).toHaveLength(1);
  });

  it('l’infobulle d’un mois manquant dit qu’aucun prélèvement n’a été trouvé', () => {
    const { points } = buildAmortizationSeries(avecTrou());
    render(<AmortizationTooltip point={points[1]} />);
    const tip = screen.getByTestId('amortization-tooltip').textContent ?? '';
    expect(tip).toContain('Février 2026');
    expect(tip).toContain('Prévu : 4');
    expect(tip).toContain('aucun prélèvement trouvé');
  });

  it('après le dernier prélèvement, l’infobulle ne donne que Prévu (rien d’inventé, L177)', () => {
    const { points } = buildAmortizationSeries(avecTrou());
    render(<AmortizationTooltip point={points[5]} />);
    const tip = screen.getByTestId('amortization-tooltip').textContent ?? '';
    expect(tip).toContain('Prévu');
    expect(tip).not.toContain('Réel');
  });

  it('la phrase sous le graphique cite le mois manquant', () => {
    render(<AmortizationChart loan={avecTrou()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, avril 2026. Interrompue en février 2026 : aucun prélèvement trouvé ce mois-là.",
    );
  });

  /** Échéances de janvier à juin ; celle de juin prélevée en retard, en juillet. */
  const prelevementTardif = () =>
    loan([
      occ('2026-01-08', -1050),
      occ('2026-02-08', -1050),
      occ('2026-03-08', -1050),
      occ('2026-04-08', -1050),
      occ('2026-05-08', -1050),
      occ('2026-07-02', -1050),
    ]);

  it('un dernier prélèvement dans un mois sans échéance a son point', () => {
    const { points, lastKnownMonth } = buildAmortizationSeries(prelevementTardif());
    expect(lastKnownMonth).toBe('2026-07');
    const juillet = points.find((p) => p.month === '2026-07');
    expect(juillet).toMatchObject({ scheduled: false, reel: 0, prevu: 0, missing: false });
    // Juin (échéance sans prélèvement, entre deux prélèvements connus) est un trou.
    expect(points.find((p) => p.month === '2026-06')?.missing).toBe(true);
  });

  it('la phrase cite le mois du dernier prélèvement, pas la dernière échéance', () => {
    const { container } = render(<AmortizationChart loan={prelevementTardif()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toMatch(
      /^Réel \(estimé\) : jusqu'au dernier prélèvement connu, juillet 2026\./,
    );
    // Le point final (juillet) est dessiné.
    const ticks = [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((t) => t.textContent);
    expect(ticks).toContain('2026-07');
    expect(container.querySelectorAll('circle[fill="#10b981"]').length).toBeGreaterThanOrEqual(1);
  });

  it('l’infobulle d’un mois sans échéance le dit', () => {
    const { points } = buildAmortizationSeries(prelevementTardif());
    render(<AmortizationTooltip point={points.find((p) => p.month === '2026-07')!} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('pas d’échéance ce mois');
  });
});
