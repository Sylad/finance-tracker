import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForecastPage } from './forecast';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

// jsdom n'a pas de mise en page : Recharts n'y dessine rien, on isole la page.
vi.mock('recharts', () => {
  const Nop = () => null;
  return {
    BarChart: Nop, Bar: Nop, XAxis: Nop, YAxis: Nop, Tooltip: Nop, ReferenceLine: Nop,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const month = (m: string) => ({ month: m, income: 100, expense: 50, net: 50, occurrences: [] });
const pending = vi.hoisted(() => ({ release: null as null | (() => void) }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status = 0; },
  api: { get, post: vi.fn() },
}));
get.mockImplementation((url: string) => {
  if (url.includes('months=6')) {
    return new Promise((resolve) => {
      pending.release = () => resolve(Array.from({ length: 6 }, (_, i) => month(`2026-1${i}`)));
    });
  }
  return Promise.resolve(Array.from({ length: 12 }, (_, i) => month(`2026-${i}`)));
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ForecastPage />
    </QueryClientProvider>,
  );
}

describe('Prévisions — sélecteur 3/6/12 mois (L88)', () => {
  it('R1 — chaque bouton expose aria-pressed ; 12 mois est pressé au départ', async () => {
    renderPage();
    const b12 = await screen.findByRole('button', { name: '12 mois' });
    expect(b12.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '3 mois' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '6 mois' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('R2 — le changement d\'horizon demande ?months= au backend', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '6 mois' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/forecast?months=6'));
  });

  it('R3 — pendant le rechargement, titre, sélecteur et focus restent en place', async () => {
    renderPage();
    const b6 = await screen.findByRole('button', { name: '6 mois' });
    b6.focus();
    fireEvent.click(b6);
    await waitFor(() => expect(pending.release).not.toBeNull());
    // la requête 6 mois est en cours : le sélecteur n'a pas été démonté
    expect(screen.getByRole('heading', { name: 'Prévisions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '6 mois' })).toBe(b6);
    expect(document.activeElement).toBe(b6);
    expect(b6.getAttribute('aria-pressed')).toBe('true');
    pending.release!();
    await waitFor(() => expect(screen.getAllByText(/^2026-1\d$/).length).toBe(6));
    expect(document.activeElement).toBe(b6);
  });
});
