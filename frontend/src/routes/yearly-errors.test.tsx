import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { YearlySummary } from '@/types/api';
import { YearlyPage } from './yearly';

const q = (over: Record<string, unknown> = {}) => ({
  isLoading: false, isError: false, isFetching: false, data: undefined as unknown, refetch: vi.fn(), ...over,
});

const state = vi.hoisted(() => ({ list: {} as ReturnType<typeof q>, detail: {} as ReturnType<typeof q> }));

vi.mock('@/lib/queries', () => ({
  useYearlySummaries: () => state.list,
  useYearlySummary: () => state.detail,
}));

vi.mock('recharts', () => {
  const Nop = () => null;
  return {
    LineChart: Nop, Line: Nop, XAxis: Nop, YAxis: Nop, Tooltip: Nop, Legend: Nop, AreaChart: Nop, Area: Nop,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const summary = {
  year: 2025, generatedAt: '2026-01-01T00:00:00Z', monthsCovered: [1], currency: 'EUR',
  totalCredits: 1000, totalDebits: 900, netSavings: 100, averageMonthlyCredits: 1000, averageMonthlyDebits: 900,
  averageHealthScore: 70, bestMonth: { month: 1, score: 70 }, worstMonth: { month: 1, score: 70 },
  scoreProgression: [{ month: 1, score: 70 }], monthlyCashFlow: [], topCategories: [], recurringCreditsCount: 0,
} as unknown as YearlySummary;

describe('Bilan annuel — erreurs de chargement (L100)', () => {
  beforeEach(() => {
    state.list = q({ data: [{ year: 2025 }, { year: 2024 }] });
    state.detail = q({ data: summary });
  });

  it('R1 — liste en échec : ErrorState avec Réessayer, jamais « Pas encore de bilan »', async () => {
    state.list = q({ isError: true });
    render(<YearlyPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les bilans annuels.');
    expect(screen.queryByText('Pas encore de bilan')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.list.refetch).toHaveBeenCalledTimes(1);
  });

  it('R2 — détail en échec : ErrorState avec Réessayer, plus de « Chargement… » sans fin', async () => {
    state.detail = q({ isError: true });
    render(<YearlyPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger le bilan 2025.');
    expect(screen.queryByText('Chargement…')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(state.detail.refetch).toHaveBeenCalledTimes(1);
  });

  it('R3 — détail en échec : le sélecteur d\'année reste là pour changer d\'année', () => {
    state.detail = q({ isError: true });
    render(<YearlyPage />);
    expect(screen.getByRole('button', { name: '2024' })).toBeTruthy();
  });

  it('R4 — un échec de rafraîchissement garde les données déjà chargées', () => {
    state.list = q({ isError: true, data: [{ year: 2025 }] });
    state.detail = q({ isError: true, data: summary });
    render(<YearlyPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Bilan 2025')).toBeTruthy();
  });

  it('R5 — Réessayer est désactivé pendant le rechargement', () => {
    state.list = q({ isError: true, isFetching: true });
    render(<YearlyPage />);
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeDisabled();
  });
});
