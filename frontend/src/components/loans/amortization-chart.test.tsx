import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AmortizationLine, Loan, LoanOccurrence } from '@/types/api';
import { mensualitesCount } from './utils';
import { formatEURCompact, formatMonth } from '@/lib/utils';
import { buildAmortizationSeries } from '@/lib/amortization-series';
import { AmortizationChart, AmortizationTooltip, deMois, listFr } from './amortization-chart';
import { monthAxisLabel, monthLabel } from '@/lib/month-label';

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

/** 6 échéances de 1 000 € de capital (le 5 de janvier à juin 2026). */
function loan(occurrences: LoanOccurrence[]): Loan {
  return loanN(6, occurrences);
}

/** `n` échéances de 1 000 € de capital, le 5 de chaque mois à partir de janvier 2026. */
function loanN(n: number, occurrences: LoanOccurrence[]): Loan {
  return {
    id: 'cetelem',
    name: 'CETELEM auto',
    type: 'classic',
    category: 'consumer',
    monthlyPayment: 1050,
    matchPattern: 'CETELEM',
    isActive: true,
    initialPrincipal: 1000 * n,
    amortizationSchedule: Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2026, i, 5));
      return line(d.toISOString().slice(0, 10), 1000 * (n - i - 1), 1000);
    }),
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
    const tip = (screen.getByTestId('amortization-tooltip').textContent ?? '').replace(/[\u00a0\u202f]/g, ' ');
    expect(tip).toContain('février 2026');
    expect(tip).toContain('Prévu : 4 000 €');
    // L179 : un mois passé, pas « ce mois-ci ».
    expect(tip).toContain('aucun prélèvement trouvé ce mois-là');
    expect(tip).not.toContain('ce mois-ci');
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
    // retard — juin n'est pas un trou « aucun prélèvement », mais n'a pas de
    // point Réel : aucun débit n'a eu lieu en juin (revue L180).
    expect(points.find((p) => p.month === '2026-06')).toMatchObject({ missing: false, reel: null, paidIn: ['2026-07'] });
  });

  it('la phrase cite le mois du dernier prélèvement, pas la dernière échéance', () => {
    const { container } = render(<AmortizationChart loan={prelevementTardif()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    expect(screen.getByTestId('amortization-reel-note').textContent).toMatch(
      /^Réel \(estimé\) : jusqu'au dernier prélèvement connu, juillet 2026\./,
    );
    // Le point final (juillet) est dessiné.
    const ticks = [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((t) => t.textContent);
    expect(ticks).toContain(monthAxisLabel('2026-07'));
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

  const debitsLe5 = (months: string[]) => months.map((m) => occ(`2026-${m}-05`, -1050));

  /** Février prélevé le 2 mars : deux prélèvements en mars, aucun en février. */
  const fevrierEnRetard = () =>
    loan([occ('2026-01-05', -1050), occ('2026-03-02', -1050), occ('2026-03-30', -1050), occ('2026-04-05', -1050)]);
  /** 12 échéances ; débits le 5 de janvier à juin, plus un débit en trop le 20 février (doublon, régularisation). */
  const enTropAuMilieu = () => loanN(12, debitsLe5(['01', '02', '03', '04', '05', '06']).concat(occ('2026-02-20', -1050)));
  /** Dernière échéance connue payée en avance : mars prélevé le 27 février, rien en mars. */
  const marsPayeEnAvance = () => loan([occ('2026-01-05', -1050), occ('2026-02-05', -1050), occ('2026-02-27', -1050)]);

  function open(l: Loan) {
    const r = render(<AmortizationChart loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    return r;
  }
  const note = () => screen.getByTestId('amortization-reel-note').textContent ?? '';
  const reelPathOf = (container: HTMLElement) =>
    ([...container.querySelectorAll('.recharts-line-curve')][1] as SVGPathElement).getAttribute('d') ?? '';

  it('février prélevé le 2 mars : février n’est pas un trou, mais n’a pas de point Réel (aucun débit ce mois-là)', () => {
    const { points, lastKnownMonth } = buildAmortizationSeries(fevrierEnRetard());
    expect(points.map((p) => p.missing)).toEqual([false, false, false, false, false, false]);
    // Réel seulement aux mois prélevés ; mars compte février (payé le 2 mars) et mars.
    expect(points.slice(0, 4).map((p) => p.reel)).toEqual([5000, null, 3000, 2000]);
    expect(points.slice(0, 4).map((p) => p.prevu)).toEqual([5000, 4000, 3000, 2000]);
    expect(points[1].paidIn).toEqual(['2026-03']);
    expect(points[2].countedFor).toEqual(['2026-02']);
    expect(lastKnownMonth).toBe('2026-04');
  });

  it('la phrase dit quelle échéance a été prélevée un autre mois, sans l’annoncer manquante', () => {
    open(fevrierEnRetard());
    expect(note()).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, avril 2026. Échéance de février 2026 prélevée en mars 2026.",
    );
  });

  it('l’infobulle dit où l’échéance a été prélevée, et pour quelle échéance compte le prélèvement', () => {
    const { points } = buildAmortizationSeries(fevrierEnRetard());
    const { unmount } = render(<AmortizationTooltip point={points[1]} />);
    const fev = screen.getByTestId('amortization-tooltip').textContent ?? '';
    expect(fev).toContain('Échéance prélevée en mars 2026');
    expect(fev).not.toContain('Réel');
    expect(fev).not.toContain('aucun prélèvement');
    unmount();
    render(<AmortizationTooltip point={points[2]} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Prélèvement compté pour l’échéance de février 2026');
  });

  it('débit en trop au milieu du tableau : rien n’est décalé, la courbe s’arrête au dernier débit réel (juin)', () => {
    const { points, lastKnownMonth, unmatchedCount } = buildAmortizationSeries(enTropAuMilieu());
    expect(unmatchedCount).toBe(1);
    expect(lastKnownMonth).toBe('2026-06');
    expect(points.slice(0, 7).map((p) => p.reel)).toEqual([11000, 10000, 9000, 8000, 7000, 6000, null]);
    expect(points.every((p) => p.paidIn.length === 0 && p.countedFor.length === 0)).toBe(true);
    const { container } = open(enTropAuMilieu());
    expect(note()).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, juin 2026. 1 prélèvement sans échéance correspondante, non compté dans le capital.",
    );
    expect(reelPathOf(container).match(/M/g)).toHaveLength(1);
  });

  it('dernière échéance payée en avance (27 février pour mars) : dernier prélèvement connu = février', () => {
    const { points, lastKnownMonth } = buildAmortizationSeries(marsPayeEnAvance());
    expect(lastKnownMonth).toBe('2026-02');
    // Le point de février compte l'argent versé en février : janvier, février et mars.
    expect(points.slice(0, 3).map((p) => p.reel)).toEqual([5000, 3000, null]);
    expect(points[2]).toMatchObject({ missing: false, paidIn: ['2026-02'] });
    open(marsPayeEnAvance());
    expect(note()).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, février 2026. Échéance de mars 2026 prélevée en février 2026.",
    );
  });

  it('un mois sans débit (échéance prélevée le mois suivant) interrompt la courbe ; chaque bord a son point', () => {
    const { container } = open(fevrierEnRetard());
    // Janvier (isolé), puis mars → avril.
    expect(reelPathOf(container).match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('circle[fill="#10b981"]')).toHaveLength(3);
  });

  /**
   * Jeux de cohérence (D-1 : « il faut juste que ça reste cohérent »). Chaque
   * vérification lit ce que l'ÉCRAN affiche — la phrase sous le graphique et
   * l'infobulle de chaque mois (le composant que le graphique rend au survol) —
   * et le compteur « mensualités prélevées » de la carte, contre les débits
   * du jeu.
   */
  const jeux: Record<string, { make: () => Loan; trous: string[] }> = {
    'février prélevé en mars': { make: fevrierEnRetard, trous: [] },
    'mars prélevé en avance fin février': {
      make: () => loan([occ('2026-01-05', -1050), occ('2026-02-05', -1050), occ('2026-02-27', -1050), occ('2026-04-05', -1050)]),
      trous: [],
    },
    'deux mois chargés puis un mois vide': {
      make: () => loan([occ('2026-01-05', -1050), occ('2026-03-01', -1050), occ('2026-03-31', -1050), occ('2026-04-30', -1050)]),
      trous: [],
    },
    'dernière échéance prélevée hors tableau': {
      make: () => loan(debitsLe5(['01', '02', '03', '04', '05']).concat(occ('2026-07-02', -1050))),
      trous: [],
    },
    'prélèvement en trop en fin de tableau': {
      make: () => loan(debitsLe5(['01', '02', '03', '04', '05', '06']).concat(occ('2026-06-20', -1050))),
      trous: [],
    },
    'débit en trop au milieu du tableau': { make: enTropAuMilieu, trous: [] },
    'dernière échéance payée en avance': { make: marsPayeEnAvance, trous: [] },
    'décalage puis vrai trou': {
      // Mars payé le 27 février ; avril sans aucun prélèvement : vrai trou.
      make: () =>
        loan([occ('2026-01-05', -1050), occ('2026-02-05', -1050), occ('2026-02-27', -1050), occ('2026-05-05', -1050), occ('2026-06-05', -1050)]),
      trous: ['avril 2026'],
    },
    'vrai trou sans décalage': { make: () => loan(debitsLe5(['01', '03', '04'])), trous: ['février 2026'] },
  };

  const label = (month: string) => formatMonth(Number(month.slice(5, 7)), Number(month.slice(0, 4))).toLowerCase();
  it('élision devant un mois à voyelle : « d’août », « d’avril », « d’octobre »', () => {
    expect(deMois('août 2026')).toBe('d’août 2026');
    expect(deMois('avril 2026')).toBe('d’avril 2026');
    expect(deMois('octobre 2026')).toBe('d’octobre 2026');
    expect(deMois('mars 2026')).toBe('de mars 2026');
  });

  const euros = (text: string) => Number(text.replace(/[^\d,]/g, '').replace(',', '.'));

  for (const [nom, { make, trous }] of Object.entries(jeux)) {
    it(`cohérence de ce que l’écran affiche — ${nom}`, () => {
      const l = make();
      const debits = l.occurrencesDetected.filter((o) => o.amount < 0);
      const debitMonths = new Set(debits.map((o) => o.date.slice(0, 7)));
      const { points } = buildAmortizationSeries(l);

      // Infobulle de chaque mois, telle que rendue au survol.
      const tips = new Map<string, string>();
      for (const p of points) {
        const { unmount } = render(<AmortizationTooltip point={p} />);
        tips.set(p.month, screen.getByTestId('amortization-tooltip').textContent ?? '');
        unmount();
      }
      const reelOf = (month: string) => {
        const m = tips.get(month)!.match(/Réel \(estimé\) : ([\d\s  ,]+€)/);
        return m ? euros(m[1]) : null;
      };

      // (1) Un point Réel exactement aux mois où un débit a eu lieu.
      for (const p of points) expect([p.month, reelOf(p.month) != null]).toEqual([p.month, debitMonths.has(p.month)]);

      open(l);
      const phrase = note();
      // (2) « Dernier prélèvement connu » = mois du dernier débit réel.
      const dernierDebit = debits.map((o) => o.date).sort().at(-1)!;
      expect(phrase).toContain(`dernier prélèvement connu, ${label(dernierDebit)}.`);

      // (3) Mensualités prélevées (carte) = échéances rattachées + prélèvements
      // non rattachés (phrase). Les rattachées se lisent sur le dernier Réel
      // affiché : capital initial − 1 000 € par échéance payée.
      const nonRattaches = Number(phrase.match(/(\d+) prélèvements? sans échéance/)?.[1] ?? 0);
      const dernierReel = reelOf(dernierDebit.slice(0, 7))!;
      const rattachees = (l.initialPrincipal! - dernierReel) / 1000;
      expect(mensualitesCount(l)).toBe(debits.length);
      expect(rattachees + nonRattaches).toBe(mensualitesCount(l));

      // (4) Trous : la phrase et les infobulles citent les mêmes mois, et ce
      // sont les mois attendus du jeu.
      const enPhrase = phrase.match(/Interrompue en (.+?) : aucun prélèvement/)?.[1] ?? '';
      const enInfobulle = points.filter((p) => tips.get(p.month)!.includes('aucun prélèvement trouvé')).map((p) => label(p.month));
      expect(enInfobulle).toEqual(trous);
      for (const t of trous) expect(enPhrase).toContain(t);
      if (trous.length === 0) expect(phrase).not.toContain('Interrompue');

      // (5) Un décalage se lit des deux côtés : « Échéance prélevée en Y » en X
      // ⇔ « Prélèvement compté pour l’échéance de X » en Y, et la phrase le cite.
      for (const p of points) {
        for (const y of p.paidIn) {
          expect(tips.get(p.month)).toContain(`Échéance prélevée en ${label(y)}`);
          expect(tips.get(y)).toContain(`Prélèvement compté pour l’échéance ${deMois(label(p.month))}`);
          expect(phrase).toContain(`${label(p.month)} prélevée en ${label(y)}`);
        }
      }

      // (6) Réel ne remonte jamais et ne passe jamais sous zéro.
      const reels = points.map((p) => reelOf(p.month)).filter((r): r is number => r != null);
      reels.forEach((r, i) => {
        expect(r).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(r).toBeLessThanOrEqual(reels[i - 1]);
      });
    });
  }
});

describe('Graphique d’amortissement — remboursement anticipé seul dans un mois (L181, D-1)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  /**
   * Anticipé de 500 € le 15 février (seul débit de février) ; la mensualité de
   * février glisse au 2 mars, celle de mars le 30 mars, avril le 5.
   */
  const anticipeSeulEnFevrier = () =>
    loan([
      occ('2026-01-05', -1050),
      { ...occ('2026-02-15', -500), source: 'early_repayment' },
      occ('2026-03-02', -1050),
      occ('2026-03-30', -1050),
      occ('2026-04-05', -1050),
    ]);

  it('la mensualité décalée est rattachée à février : aucun prélèvement non rattaché, le Réel suit les quatre échéances', () => {
    const { points, lastKnownMonth, unmatchedCount } = buildAmortizationSeries(anticipeSeulEnFevrier());
    expect(unmatchedCount).toBe(0);
    expect(lastKnownMonth).toBe('2026-04');
    // Février a un point (l'anticipé est un débit) : 6 000 − 1 000 (janv.) − 500 (anticipé).
    // Mars compte février (payé le 2 mars) et mars ; avril, la sienne.
    expect(points.slice(0, 4).map((p) => p.reel)).toEqual([5000, 4500, 2500, 1500]);
    expect(points[1]).toMatchObject({ missing: false, paidIn: ['2026-03'] });
    expect(points[2].countedFor).toEqual(['2026-02']);
  });

  it('la phrase et les infobulles disent que février a été prélevé en mars, sans prélèvement « sans échéance »', () => {
    render(<AmortizationChart loan={anticipeSeulEnFevrier()} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    const phrase = screen.getByTestId('amortization-reel-note').textContent ?? '';
    expect(phrase).toBe(
      "Réel (estimé) : jusqu'au dernier prélèvement connu, avril 2026. Échéance de février 2026 prélevée en mars 2026.",
    );
    const { points } = buildAmortizationSeries(anticipeSeulEnFevrier());
    const { unmount } = render(<AmortizationTooltip point={points[1]} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Échéance prélevée en mars 2026');
    unmount();
    render(<AmortizationTooltip point={points[2]} />);
    expect(screen.getByTestId('amortization-tooltip').textContent).toContain('Prélèvement compté pour l’échéance de février 2026');
  });

  it('cohérence : mensualités prélevées = échéances rattachées ; capital = initial − échéances − anticipé', () => {
    const l = anticipeSeulEnFevrier();
    const { points } = buildAmortizationSeries(l);
    expect(mensualitesCount(l)).toBe(4);
    const dernierReel = points.find((p) => p.month === '2026-04')!.reel!;
    expect((l.initialPrincipal! - 500 - dernierReel) / 1000).toBe(mensualitesCount(l));
  });
});

describe('Graphique d’amortissement — écriture des mois et des montants (L179)', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

  function open(l: Loan) {
    const r = render(<AmortizationChart loan={l} />);
    fireEvent.click(screen.getByRole('button', { name: /tableau d'amortissement/i }));
    return r;
  }
  const tipOf = (l: Loan, month: string) => {
    const { points } = buildAmortizationSeries(l);
    const { unmount } = render(<AmortizationTooltip point={points.find((p) => p.month === month)!} />);
    const text = sp(screen.getByTestId('amortization-tooltip').textContent ?? '');
    unmount();
    return text;
  };
  /** Espaces insécables d'Intl (avant €, séparateur de milliers) → espace simple. */
  const sp = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');
  const xTicks = (c: HTMLElement) =>
    [...c.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value')].map((t) => t.textContent ?? '');
  const yTicks = (c: HTMLElement) =>
    [...c.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map((t) => t.textContent ?? '');

  /** Capital à centimes : 5 432,67 € restant après janvier. */
  const aCentimes = (): Loan => {
    const l = loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050)]);
    l.initialPrincipal = 6432.67;
    l.amortizationSchedule = l.amortizationSchedule!.map((x, i) => ({ ...x, capitalRemaining: 5432.67 - 1000 * i }));
    return l;
  };

  it('infobulle : montants en euros entiers, sans centimes (même arrondi que la courbe)', () => {
    const jan = tipOf(aCentimes(), '2026-01');
    expect(jan).toContain('Prévu : 5 433 €');
    expect(jan).toContain('Réel (estimé) : 5 433 €');
    expect(jan).not.toMatch(/,\d\d\s?€/);
  });

  it('L182 — axe en forme courte (« Jan 26 »), infobulle et phrase en forme de texte (« février 2026 »)', () => {
    const l = loan([occ('2026-01-08', -1050), occ('2026-03-08', -1050), occ('2026-04-08', -1050)]);
    const { container } = open(l);
    const ticks = xTicks(container);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t).toMatch(/^[A-ZÉ][a-zéû]{2,3} \d{2}$/);
    expect(ticks).toContain(monthAxisLabel('2026-01'));
    // Février : l'infobulle et la phrase écrivent « février 2026 ».
    expect(tipOf(l, '2026-02').startsWith('février 2026')).toBe(true);
    expect(screen.getByTestId('amortization-reel-note').textContent).toContain('Interrompue en février 2026');
    expect(monthLabel('2026-02')).toBe('février 2026');
  });

  it('axe Y : graduations en euros (formatEURCompact), plus de « 5k »', () => {
    const { container } = open(loanN(24, [occ('2026-01-08', -1050)]));
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) expect(t).toMatch(/€$/);
    expect(ticks.some((t) => /k$/.test(t))).toBe(false);
    expect(ticks).toContain(formatEURCompact(24_000));
  });

  it('cinq mois manquants : un seul « et » dans la phrase', () => {
    expect(listFr(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c et 2 autres');
    expect(listFr(['a', 'b', 'c', 'd'])).toBe('a, b, c et 1 autre');
    expect(listFr(['a', 'b', 'c'])).toBe('a, b et c');
    open(loanN(12, [occ('2026-01-05', -1050), occ('2026-07-05', -1050)]));
    const phrase = screen.getByTestId('amortization-reel-note').textContent ?? '';
    expect(phrase).toContain('Interrompue en février 2026, mars 2026, avril 2026 et 2 autres : aucun prélèvement trouvé ces mois-là.');
    expect(phrase.match(/ et /g)).toHaveLength(1);
  });

  it('prélèvement avant la 1re échéance : l’infobulle dit « pas d’échéance ce mois »', () => {
    // Échéance de janvier prélevée le 29 décembre, avant la première ligne du tableau.
    const l = loan([occ('2025-12-29', -1050), occ('2026-02-05', -1050)]);
    const { points } = buildAmortizationSeries(l);
    expect(points[0]).toMatchObject({ month: '2025-12', scheduled: false, prevu: null, reel: 5000 });
    const tip = tipOf(l, '2025-12');
    expect(tip).toContain('Prévu : pas d’échéance ce mois');
    expect(tip).toContain('Réel (estimé) : 5 000');
    expect(tip).toContain('Prélèvement compté pour l’échéance de janvier 2026');
  });

  /** Échéances de janvier à juin ; juin prélevée en retard, le 2 juillet (mois sans échéance). */
  const juilletHorsTableau = () =>
    loan(['01', '02', '03', '04', '05'].map((m) => occ(`2026-${m}-08`, -1050)).concat(occ('2026-07-02', -1050)));

  it('le point de juillet est dessiné à l’abscisse de juillet, au niveau de 0 €', () => {
    const { container } = open(juilletHorsTableau());
    const tick = [...container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick')].find(
      (t) => t.textContent === monthAxisLabel('2026-07'),
    );
    expect(tick).toBeDefined();
    const tickX = Number(tick!.querySelector('text')!.getAttribute('x'));
    const dots = [...container.querySelectorAll('circle[fill="#10b981"]')];
    const last = dots.map((d) => ({ x: Number(d.getAttribute('cx')), y: Number(d.getAttribute('cy')) })).sort((a, b) => a.x - b.x).at(-1)!;
    expect(last.x).toBeCloseTo(tickX, 0);
    // 0 € : le bas de la zone de tracé, là où est la graduation « 0 € ».
    const zero = [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick')].find(
      (t) => t.textContent === formatEURCompact(0),
    )!;
    expect(last.y).toBeCloseTo(Number(zero.querySelector('text')!.getAttribute('y')), 0);
  });

  it('branchement de l’infobulle : survoler le graphique affiche l’infobulle du mois survolé', () => {
    const { container } = open(juilletHorsTableau());
    const tick = [...container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick')].find(
      (t) => t.textContent === monthAxisLabel('2026-07'),
    )!;
    const x = Number(tick.querySelector('text')!.getAttribute('x'));
    expect(screen.queryByTestId('amortization-tooltip')).toBeNull();
    fireEvent.mouseMove(container.querySelector('.recharts-wrapper')!, { clientX: x, clientY: 80 });
    const tip = sp(screen.getByTestId('amortization-tooltip').textContent ?? '');
    expect(tip.startsWith('juillet 2026')).toBe(true);
    expect(tip).toContain('Prévu : 0 € (pas d’échéance ce mois)');
    expect(tip).toContain('Réel (estimé) : 0 €');
    expect(tip).toContain('Prélèvement compté pour l’échéance de juin 2026');
  });
});
