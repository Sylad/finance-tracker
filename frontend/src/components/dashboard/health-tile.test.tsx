import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { HealthTile } from './health-tile';
import type { HealthDiagnostic } from '@/types/api';

const block = (status: string, thresholdHit: string | null) => ({ status, thresholdHit });
const diagnostic = {
  verdict: 'orange',
  causes: [],
  blocks: {
    resteAVivre: block('green', null),
    chargeDette: block('orange', "orange car taux d'effort 70.5 % > 35 %"),
    fluxTirages: block('green', null),
    trajectoire: block('green', null),
  },
  income: { monthly: 2000, source: 'detected', label: null },
  reliability: 'ok',
  computedAt: '2026-10-17T00:00:00Z',
} as unknown as HealthDiagnostic;

beforeAll(() => { window.scrollTo = vi.fn(); });

async function renderTile() {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/', component: () => <HealthTile diagnostic={diagnostic} /> });
  const health = createRoute({ getParentRoute: () => root, path: '/health', component: () => null });
  const router = createRouter({ routeTree: root.addChildren([route, health]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText(/Points d'attention/);
}

describe('<HealthTile /> — source qui fait foi (L81)', () => {
  it('le point « Taux d\'effort » vient du diagnostic santé seul, sans /api/dashboard/alerts', async () => {
    await renderTile();
    expect(screen.getByText(/Taux d'effort : 70,5 % des revenus/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/health');
  });
});
