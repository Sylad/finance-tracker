// L174 — QA de L169 (WCAG 2.5.8, taille de cible minimale) : « Fermer » du bandeau d'installation
// et « Détails » des cartes de /health faisaient 16 px. On MESURE leur boîte cliquable (classes
// Tailwind recomposées avec le thème résolu, cf. src/test/tailwind-box.ts : jsdom n'a pas de mise
// en page) : au moins 24 px, et la place qu'elles occupent dans la mise en page reste celle
// d'avant (16 px), pour que rien ne bouge autour.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstallPrompt } from './install-prompt';
import { HealthPage } from '@/routes/health';
import { tailwindBox } from '@/test/tailwind-box';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const block = (details: Record<string, number>) => ({ status: 'green', thresholdHit: null, details });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.get.mockImplementation((url: string) => {
    if (url === '/health-check/diagnostic') {
      return Promise.resolve({
        verdict: 'green', causes: [], reliability: 'ok', computedAt: '2026-10-01T00:00:00Z',
        income: { monthly: 2400, source: 'detected', label: null },
        blocks: {
          resteAVivre: block({ resteAVivre: 800, income: 2400 }),
          chargeDette: block({ tauxEffortPct: 20 }),
          fluxTirages: block({ flux: 0 }),
          trajectoire: block({ sumUsed: 1000, sumProjected: 1000, horizonMonths: 6 }),
        },
      });
    }
    return Promise.resolve(undefined);
  });
});

describe('Cibles ≥ 24 px sans décaler la mise en page (L174, WCAG 2.5.8)', () => {
  it('bandeau d’installation — « Fermer » : 24 × 24 px cliquables, 16 × 16 px de place', () => {
    render(<InstallPrompt />);
    const evt = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    act(() => {
      window.dispatchEvent(evt);
    });
    const box = tailwindBox(screen.getByRole('button', { name: 'Fermer' }));
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect([box.layoutWidth, box.layoutHeight]).toEqual([16, 16]);
  });

  it('/health — « Détails » de chaque carte : 24 px de haut cliquables, 16 px de place', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HealthPage />
      </QueryClientProvider>,
    );
    const summaries = await screen.findAllByText('Détails', { selector: 'summary' });
    expect(summaries).toHaveLength(4);
    for (const s of summaries) {
      const box = tailwindBox(s);
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.layoutHeight).toBe(16);
    }
  });
});
