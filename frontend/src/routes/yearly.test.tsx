import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { YearlySummary } from '@/types/api';
import { YearlyPage } from './yearly';
import { SquareDot, CashFlowLegend } from './yearly-chart-marks';

const state = vi.hoisted(() => ({
  list: { isLoading: false, data: undefined as unknown },
  detail: { data: undefined as unknown },
}));

vi.mock('@/lib/queries', () => ({
  useYearlySummaries: () => state.list,
  useYearlySummary: () => state.detail,
}));

// jsdom n'a pas de mise en page : Recharts n'y dessine rien, on isole la page.
// Les propriétés qui décident du rendu (trait, marqueur, largeur d'axe, marge) sont exposées en data-*.
vi.mock('recharts', () => {
  const Nop = () => null;
  return {
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, XAxis: Nop, Tooltip: Nop, Legend: (p: { content?: React.ReactNode }) => <>{p.content ?? null}</>, Area: Nop,
    Line: (p: { name: string; strokeDasharray?: string; dot?: unknown }) => (
      <span data-testid={`line-${p.name}`} data-dash={p.strokeDasharray ?? ''} data-dot={typeof p.dot} />
    ),
    YAxis: (p: { width?: number; domain?: number[] }) => (
      p.domain ? <span data-testid="score-axis" data-width={p.width} /> : null
    ),
    AreaChart: (p: { margin?: { left?: number }; children: React.ReactNode }) => (
      <svg data-testid="score-chart" data-margin-left={p.margin?.left ?? 0}>{p.children}</svg>
    ),
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const summary = (monthlyCashFlow?: YearlySummary['monthlyCashFlow']): YearlySummary => ({
  year: 2025,
  generatedAt: '2026-01-01T00:00:00Z',
  monthsCovered: [1, 2],
  currency: 'EUR',
  totalCredits: 2500,
  totalDebits: 2300,
  netSavings: 200,
  savingsDeposited: 150,
  averageMonthlyCredits: 1250,
  averageMonthlyDebits: 1150,
  averageHealthScore: 70,
  bestMonth: { month: 2, score: 80 },
  worstMonth: { month: 1, score: 60 },
  scoreProgression: [{ month: 1, score: 60 }, { month: 2, score: 80 }],
  monthlyCashFlow,
  topCategories: [],
  recurringCreditsCount: 1,
});

const NO_FLOW = 'Pas de flux mensuels disponibles pour cette année.';

describe('<YearlyPage /> (L65)', () => {
  beforeEach(() => {
    state.list = { isLoading: false, data: [{ year: 2025 }] };
    state.detail = { data: summary([{ month: 1, credits: 1000, debits: 1100, net: -100 }]) };
  });

  it('passe de la liste en chargement au bilan chargé sans changer le nombre de hooks', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.list = { isLoading: true, data: undefined };
    state.detail = { data: undefined };
    const { rerender } = render(<YearlyPage />);

    state.list = { isLoading: false, data: [{ year: 2025 }] };
    state.detail = { data: summary([{ month: 1, credits: 1000, debits: 1100, net: -100 }]) };
    expect(() => rerender(<YearlyPage />)).not.toThrow();

    expect(screen.getByText('Cash flow mensuel')).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('affiche le graphique quand le bilan porte des flux mensuels', () => {
    render(<YearlyPage />);
    expect(screen.queryByText(NO_FLOW)).toBeNull();
  });

  it.each([[undefined], [[]]])('affiche le message quand monthlyCashFlow vaut %j', (flow) => {
    state.detail = { data: summary(flow as YearlySummary['monthlyCashFlow']) };
    render(<YearlyPage />);
    expect(screen.getByText(NO_FLOW)).toBeTruthy();
  });

  it('L101 — les cartes parlent d\'Entrées, de Sorties et de Revenus récurrents, plus de Crédits ni de Débits', () => {
    render(<YearlyPage />);
    expect(screen.getAllByText('Entrées').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sorties').length).toBeGreaterThan(0);
    expect(screen.getByText('Revenus récurrents')).toBeTruthy();
    expect(screen.queryByText('Crédits')).toBeNull();
    expect(screen.queryByText('Débits')).toBeNull();
    expect(screen.queryByText('Crédits récurrents')).toBeNull();
  });

  it('L104 — la carte se nomme « Solde net (entrées − sorties) », plus « Épargne nette »', () => {
    render(<YearlyPage />);
    expect(screen.getByText('Solde net (entrées − sorties)')).toBeTruthy();
    expect(screen.queryByText('Épargne nette')).toBeNull();
  });

  it('L104 — la carte affiche « dont X € versés en épargne » avec le total du bilan', () => {
    render(<YearlyPage />);
    const line = screen.getByText(/dont .* versés en épargne/);
    expect(line.textContent?.replace(/\s/g, ' ')).toContain('150');
  });

  it('L104 — sans total versé (bilan sans donnée), la ligne « dont » n\'est pas affichée', () => {
    state.detail = { data: { ...summary([{ month: 1, credits: 1, debits: 1, net: 0 }]), savingsDeposited: undefined } };
    render(<YearlyPage />);
    expect(screen.queryByText(/versés en épargne/)).toBeNull();
  });

  it('R1 — le sélecteur d\'année expose aria-pressed et marque l\'année choisie d\'un liseré d\'accent (≥ 3:1)', () => {
    state.list = { isLoading: false, data: [{ year: 2025 }, { year: 2024 }] };
    render(<YearlyPage />);
    const y25 = screen.getByRole('button', { name: '2025' });
    const y24 = screen.getByRole('button', { name: '2024' });
    expect(y25.getAttribute('aria-pressed')).toBe('true');
    expect(y24.getAttribute('aria-pressed')).toBe('false');
    expect(y25.className).toContain('ring-accent');
    expect(y24.className).not.toContain('ring-accent');
    fireEvent.click(y24);
    expect(y24.getAttribute('aria-pressed')).toBe('true');
    expect(y25.getAttribute('aria-pressed')).toBe('false');
    expect(y24.className).toContain('ring-accent');
  });

  it('L99 R1 — chaque graphique porte un aria-label de résumé (role=img) lisible sans souris', () => {
    render(<YearlyPage />);
    const imgs = screen.getAllByRole('img').map((e) => e.getAttribute('aria-label') ?? '');
    expect(imgs.some((l) => l.startsWith('Progression du score sur 2 mois'))).toBe(true);
    expect(imgs.some((l) => l.startsWith('Entrées et sorties sur 1 mois.'))).toBe(true);
  });

  it('L99 R2 — un tableau Mois/Score/Entrées/Sorties/Solde donne les valeurs de chaque mois', () => {
    state.detail = { data: summary([
      { month: 1, credits: 1000, debits: 1100, net: -100 },
      { month: 2, credits: 1500, debits: 1200, net: 300 },
    ]) };
    render(<YearlyPage />);
    const table = screen.getByRole('table', { name: 'Détail mois par mois' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Mois', 'Score', 'Entrées', 'Sorties', 'Solde']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const feb = within(rows[1]).getAllByRole('cell').map((c) => c.textContent?.replace(/\s/g, ' '));
    expect(feb[0]).toBe('80');
    expect(feb[1]).toContain('500');
    expect(feb[2]).toContain('200');
    expect(feb[3]).toContain('+');
    expect(feb[3]).toContain('300');
  });

  it('L99 R2 — un mois sans flux (bilan ancien) garde sa ligne avec « — » pour les montants', () => {
    state.detail = { data: summary(undefined) };
    render(<YearlyPage />);
    const table = screen.getByRole('table', { name: 'Détail mois par mois' });
    const first = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(first.slice(1)).toEqual(['—', '—', '—']);
  });

  it('L99 R3 — Sorties se distingue d\'Entrées par un trait pointillé et un marqueur carré, pas seulement la couleur', () => {
    render(<YearlyPage />);
    expect(screen.getByTestId('line-Sorties').getAttribute('data-dash')).not.toBe('');
    expect(screen.getByTestId('line-Entrées').getAttribute('data-dash')).toBe('');
    expect(screen.getByTestId('line-Sorties').getAttribute('data-dot')).toBe('object'); // élément <SquareDot />
    expect(screen.getByTestId('line-Entrées').getAttribute('data-dot')).toBe('object');
    const { container } = render(<svg><SquareDot cx={10} cy={20} stroke="red" /></svg>);
    const rect = container.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('stroke')).toBe('red');
  });

  it('L106 R1 — la légende dessine Entrées en trait plein à rond et Sorties en pointillé à carré', () => {
    render(<YearlyPage />);
    const legend = screen.getByTestId('cashflow-legend');
    const entrees = within(legend).getByText('Entrées').closest('li') as HTMLElement;
    const sorties = within(legend).getByText('Sorties').closest('li') as HTMLElement;
    expect(entrees.querySelector('line')?.getAttribute('stroke-dasharray')).toBeNull();
    expect(entrees.querySelector('circle')).not.toBeNull();
    expect(entrees.querySelector('rect')).toBeNull();
    expect(sorties.querySelector('line')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(sorties.querySelector('rect')).not.toBeNull();
    expect(sorties.querySelector('circle')).toBeNull();
  });

  it('L106 R2 — la légende garde les couleurs des courbes et masque ses pictogrammes aux lecteurs d\'écran', () => {
    const { container } = render(<CashFlowLegend />);
    const strokes = [...container.querySelectorAll('line')].map((l) => l.getAttribute('stroke'));
    expect(strokes).toEqual(['hsl(160 84% 50%)', 'hsl(0 84% 60%)']);
    container.querySelectorAll('svg').forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));
  });

  it('L99 R3 — SquareDot ne dessine rien sans coordonnées', () => {
    const { container } = render(<svg><SquareDot stroke="red" /></svg>);
    expect(container.querySelector('rect')).toBeNull();
  });

  it('L99 R4 — les titres de section sont des h2', () => {
    render(<YearlyPage />);
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(expect.arrayContaining([
      'Progression du score', 'Top catégories de dépense', 'Cash flow mensuel', 'Détail mois par mois',
    ]));
  });

  it('L99 R5 — l\'axe du score laisse la place à « 100 » (largeur + marge gauche ≥ 30 px)', () => {
    render(<YearlyPage />);
    const width = Number(screen.getByTestId('score-axis').getAttribute('data-width'));
    const left = Number(screen.getByTestId('score-chart').getAttribute('data-margin-left'));
    expect(width + left).toBeGreaterThanOrEqual(30);
  });
});
