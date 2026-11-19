import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AmortizationLine, Loan, LoanOccurrence } from '@/types/api';
import { computeLoanState } from '@/lib/loan-state';
import { mensualitesCount } from './utils';
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
    expect(juillet).toMatchObject({ scheduled: false, reel: 0, prevu: 0, missing: false, countedFor: ['2026-06'] });
    // L180 (D-1) : le prélèvement de juillet est l'échéance de juin, payée en
    // retard — juin n'est plus un faux trou, il porte ce prélèvement.
    expect(points.find((p) => p.month === '2026-06')).toMatchObject({ missing: false, reel: 0, paidIn: ['2026-07'] });
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

describe('Graphique d’amortissement — prélèvements décalés d’un mois (L180, D-1)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  /** Février prélevé le 2 mars : deux prélèvements en mars, aucun en février. */
  const fevrierEnRetard = () =>
    loan([occ('2026-01-05', -1050), occ('2026-03-02', -1050), occ('2026-03-30', -1050), occ('2026-04-05', -1050)]);

  const jeux: Record<string, () => Loan> = {
    'février prélevé en mars': fevrierEnRetard,
    'mars prélevé en avance fin février': () =>
      loan([occ('2026-01-05', -1050), occ('2026-02-05', -1050), occ('2026-02-27', -1050), occ('2026-04-05', -1050)]),
    'décalages en chaîne, puis un mois vide': () =>
      loan([occ('2026-01-05', -1050), occ('2026-03-01', -1050), occ('2026-03-31', -1050), occ('2026-04-30', -1050)]),
    'dernière échéance prélevée hors tableau': () =>
      loan([occ('2026-01-08', -1050), occ('2026-02-08', -1050), occ('2026-03-08', -1050), occ('2026-04-08', -1050), occ('2026-05-08', -1050), occ('2026-07-02', -1050)]),
    'prélèvement en trop, voisins pleins': () =>
      loan(['01', '02', '03', '04', '05', '06'].map((m) => occ(`2026-${m}-05`, -1050)).concat(occ('2026-02-20', -1050))),
  };

  it('un prélèvement décalé comble le mois resté vide : ni trou ni courbe décalée d’une échéance', () => {
    const { points } = buildAmortizationSeries(fevrierEnRetard());
    expect(points.map((p) => p.missing)).toEqual([false, false, false, false, false, false]);
    // Réel suit Prévu échéance par échéance, au lieu d'avoir 1 000 € de retard dès mars.
    expect(points.slice(0, 4).map((p) => p.reel)).toEqual([5000, 4000, 3000, 2000]);
    expect(points.slice(0, 4).map((p) => p.prevu)).toEqual([5000, 4000, 3000, 2000]);
    expect(points[1].paidIn).toEqual(['2026-03']);
    expect(points[2].countedFor).toEqual(['2026-02']);
  });

  it('la courbe Réel reste d’un seul tenant et la phrase ne cite aucun trou', () => {
    const { container } = render(<AmortizationChart loan={fevrierEnRetard()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    const paths = [...container.querySelectorAll('.recharts-line-curve')];
    expect(paths[1].getAttribute('d')?.match(/M/g)).toHaveLength(1);
    expect(screen.getByTestId('amortization-reel-note').textContent).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, avril 2026.",
    );
  });

  it('l’infobulle dit où l’échéance a été prélevée, et pour quelle échéance compte le prélèvement', () => {
    const { points } = buildAmortizationSeries(fevrierEnRetard());
    const { unmount } = render(<AmortizationTooltip point={points[1]} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Réel (estimé) : 4');
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Échéance prélevée en mars 2026');
    expect(screen.getByTestId('amortization-tooltip').textContent).not.toContain('aucun prélèvement');
    unmount();
    render(<AmortizationTooltip point={points[2]} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Prélèvement compté pour l’échéance de février 2026');
  });

  it('un prélèvement sans échéance libre est dit dans la phrase, pas compté deux fois', () => {
    const l = jeux['prélèvement en trop, voisins pleins']();
    const { unmatchedCount, points } = buildAmortizationSeries(l);
    expect(unmatchedCount).toBe(1);
    expect(points[points.length - 1].reel).toBe(0);
    render(<AmortizationChart loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, juin 2026. 1 prélèvement sans échéance correspondante, non compté dans le capital.",
    );
  });

  for (const [nom, make] of Object.entries(jeux)) {
    it(`cohérence des chiffres — ${nom}`, () => {
      const l = make();
      const debits = l.occurrencesDetected.filter((o) => o.amount < 0);
      const series = buildAmortizationSeries(l);
      const state = computeLoanState(l, '2099-12-31');
      // (1) chaque prélèvement compté une fois : total prélevé = somme des prélèvements.
      expect(state.totalPaid).toBe(debits.reduce((s, o) => s + Math.abs(o.amount), 0));
      // Mensualités prélevées (carte) = prélèvements rattachés + non rattachés.
      const rattaches = series.points.reduce((n, p) => n + p.paidIn.length, 0);
      expect(mensualitesCount(l)).toBe(debits.length);
      expect(rattaches).toBeLessThanOrEqual(debits.length);
      // Capital restant : dernier point Réel = capital estimé du crédit = capital
      // initial − 1 000 € par échéance rattachée (aucune comptée deux fois).
      const dernier = series.points.filter((p) => p.reel != null).at(-1)!;
      expect(dernier.month).toBe(series.lastKnownMonth);
      expect(dernier.reel).toBe(Math.round(state.capitalRemaining.estimatedFromOccurrences!));
      expect(dernier.reel).toBe(Math.max(0, 6000 - 1000 * (debits.length - series.unmatchedCount)));
      // Réel ne remonte jamais et ne passe jamais sous zéro.
      const reels = series.points.map((p) => p.reel).filter((r): r is number => r != null);
      reels.forEach((r, i) => {
        expect(r).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(r).toBeLessThanOrEqual(reels[i - 1]);
      });
      // Aucun mois d'échéance porteur d'un prélèvement n'est annoncé manquant.
      for (const p of series.points) if (p.missing) expect(p.reel).toBeNull();
      // Phrase et infobulle d'accord : un mois cité « manquant » est exactement un mois sans Réel.
      const missing = series.points.filter((p) => p.missing).map((p) => p.month);
      expect(missing).toEqual([]);
    });
  }
});
