import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { YearlySummary } from '@/types/api';
import { YearlyPage } from './yearly';

const state = vi.hoisted(() => ({
  list: { isLoading: false, data: undefined as unknown },
  detail: { data: undefined as unknown },
}));

vi.mock('@/lib/queries', () => ({
  useYearlySummaries: () => state.list,
  useYearlySummary: () => state.detail,
}));

// jsdom n'a pas de mise en page : Recharts n'y dessine rien, on isole la page.
vi.mock('recharts', () => {
  const Nop = () => null;
  return {
    LineChart: Nop, Line: Nop, XAxis: Nop, YAxis: Nop, Tooltip: Nop, Legend: Nop, AreaChart: Nop, Area: Nop,
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
    expect(screen.getByText('Entrées')).toBeTruthy();
    expect(screen.getByText('Sorties')).toBeTruthy();
    expect(screen.getByText('Revenus récurrents')).toBeTruthy();
    expect(screen.queryByText('Crédits')).toBeNull();
    expect(screen.queryByText('Débits')).toBeNull();
    expect(screen.queryByText('Crédits récurrents')).toBeNull();
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
});
