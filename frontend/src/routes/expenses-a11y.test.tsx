// L169 — le camembert des dépenses double la légende cliquable : il est masqué aux lecteurs
// d'écran (aria-hidden) et sorti de l'ordre de tabulation (rootTabIndex=-1), sinon c'est un
// arrêt de tabulation muet (WCAG 1.1.1, 2.4.3, 4.1.2). La légende garde l'information.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpensesPage } from './expenses';

vi.mock('@/lib/queries', () => ({ useDemoStatus: () => ({ data: { forced: false } }) }));
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status = 0; },
  api: {
    post: vi.fn(),
    get: vi.fn((url: string) => Promise.resolve(url === '/statements' ? [{ id: '2026-09' }] : {
      monthId: '2026-09', totalDebits: 100,
      buckets: {
        credits: { total: 0, transactions: [] }, subscriptions: { total: 0, transactions: [] },
        savings: { total: 0, transactions: [] }, neutral: { total: 0, transactions: [] },
      },
      categories: [{ category: 'food', total: 100, count: 1, transactions: [{ id: 't1', date: '2026-09-03', description: 'MARCHE DEMO', amount: -100 }] }],
    })),
  },
}));
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // Comme le <g> racine de recharts : tabindex 0 par défaut, rootTabIndex sinon.
  Pie: ({ rootTabIndex = 0 }: { rootTabIndex?: number }) => <svg data-testid="camembert" tabIndex={rootTabIndex} />,
  Cell: () => null, Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ExpensesPage — camembert et clavier (L169)', () => {
  it('le camembert est masqué aux lecteurs d’écran et hors tabulation ; la légende reste atteignable', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ExpensesPage />
      </QueryClientProvider>,
    );
    const pie = await screen.findByTestId('camembert');
    expect(pie.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(pie.tabIndex).toBe(-1);
    const legend = screen.getAllByRole('button').filter((b) => /100,0 %/.test(b.textContent ?? ''));
    expect(legend.length).toBeGreaterThan(0);
    expect(legend[0].closest('[aria-hidden="true"]')).toBeNull();
  });
});
