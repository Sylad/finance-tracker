import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { DashboardPage } from './index';

const q = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, fetchStatus: 'idle', refetch: vi.fn() });

const tx = { id: 't1', date: '2026-09-10', description: 'CB TABAC', normalizedDescription: 'CB TABAC', amount: -5,
  currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 0.9 };

vi.mock('@/lib/queries', () => ({
  useStatements: () => q([{ id: '2026-09', month: 9, year: 2026, totalCredits: 0, totalDebits: 5, closingBalance: 0, healthScore: 70, trend: 'stable' }]),
  useStatement: () => q({ transactions: [tx], healthScore: { claudeComment: '' } }),
  useScoreHistory: () => q([]),
  useBudget: () => q(undefined),
  useSavingsAccounts: () => q([]),
  useLoans: () => q([]),
  useNetWorth: () => q(undefined),
  useAlerts: () => q([]),
  useYearlyOverview: () => q(undefined),
  useHealthDiagnostic: () => q(undefined),
}));

// Sous-composants lourds (graphiques Recharts…) : hors sujet ici.
vi.mock('@/components/dashboard/score-trend-chart', () => ({ ScoreTrendChart: () => null }));
vi.mock('@/components/dashboard/balance-trend-chart', () => ({ BalanceTrendChart: () => null }));
vi.mock('@/components/dashboard/yearly-charts', () => ({ YearlyCharts: () => null }));
vi.mock('@/components/dashboard/budget-snapshot', () => ({ BudgetSnapshot: () => null }));
vi.mock('@/components/dashboard/recent-statements', () => ({ RecentStatements: () => null }));
vi.mock('@/components/dashboard/health-tile', () => ({ HealthTile: () => null }));

beforeAll(() => { window.scrollTo = vi.fn(); });

describe('<DashboardPage /> — tuile qualité de catégorisation (L74)', () => {
  it('pose la tuile avec le relevé courant : elle mène à /history/<id>', async () => {
    const rootRoute = createRootRoute();
    const dash = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });
    const history = createRoute({ getParentRoute: () => rootRoute, path: '/history/$id', component: () => null });
    const router = createRouter({
      routeTree: rootRoute.addChildren([dash, history]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={router} />);
    const links = await screen.findAllByRole('link', { name: /Transactions sans catégorie/ });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/history/2026-09');
  });
});
