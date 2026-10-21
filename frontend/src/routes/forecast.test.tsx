import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForecastPage } from './forecast';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

// jsdom n'a pas de mise en page : Recharts n'y dessine rien, on isole la page.
vi.mock('recharts', () => {
  const Nop = () => null;
  return {
    ComposedChart: Nop, Bar: Nop, Line: Nop, XAxis: Nop, YAxis: Nop, Tooltip: Nop, ReferenceLine: Nop,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const occ = { declarationId: 'd1', label: 'Salaire', type: 'income', amountSigned: 100, matched: false };
const month = (m: string, occurrences: unknown[] = [occ]) => ({ month: m, income: 100, expense: 50, net: 50, occurrences });
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

describe('Prévisions — erreur et absence de déclaration (L89)', () => {
  const defaultImpl = get.getMockImplementation()!;

  it('R1 — une erreur API affiche ErrorState avec Réessayer, jamais « Pas de déclaration »', async () => {
    get.mockImplementation(() => Promise.reject(new Error('boom')));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Pas de déclaration/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Prévisions' })).toBeTruthy();
    get.mockImplementation(defaultImpl);
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getAllByText(/^2026-\d+$/).length).toBe(12);
  });

  it('R2 — des mois tous sans occurrence donnent l\'état vide avec lien vers Déclarations, sans carte à 0 €', async () => {
    get.mockImplementation(() => Promise.resolve(
      Array.from({ length: 12 }, (_, i) => ({ month: `2026-${i}`, income: 0, expense: 0, net: 0, occurrences: [] })),
    ));
    renderPage();
    expect(await screen.findByText(/Pas de déclaration/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Déclarations/ }).getAttribute('href')).toBe('/declarations');
    expect(screen.queryByText(/^2026-\d+$/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    get.mockImplementation(defaultImpl);
  });

  it('R3 — une liste vide donne le même état vide', async () => {
    get.mockImplementation(() => Promise.resolve([]));
    renderPage();
    expect(await screen.findByRole('link', { name: /Déclarations/ })).toBeTruthy();
    get.mockImplementation(defaultImpl);
  });

  it('R5 — horizon réduit vide : le sélecteur reste, le message est exact et 12 mois ramène la projection', async () => {
    get.mockImplementation((url: string) => Promise.resolve(
      url.includes('months=3')
        ? Array.from({ length: 3 }, (_, i) => ({ month: `2026-0${i}`, income: 0, expense: 0, net: 0, occurrences: [] }))
        : [month('2026-05')],
    ));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '3 mois' }));
    expect(await screen.findByText(/Aucune échéance sur les 3 prochains mois/)).toBeTruthy();
    expect(screen.queryByText(/Pas de déclaration/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '12 mois' }));
    expect(await screen.findByText('2026-05')).toBeTruthy();
    get.mockImplementation(defaultImpl);
  });

  it('R6 — un échec au changement d\'horizon garde le sélecteur et le focus, et 12 mois ramène la projection', async () => {
    get.mockImplementation((url: string) => (url.includes('months=3')
      ? Promise.reject(new Error('boom'))
      : Promise.resolve([month('2026-05')])));
    renderPage();
    const b3 = await screen.findByRole('button', { name: '3 mois' });
    b3.focus();
    fireEvent.click(b3);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: '3 mois' })).toBe(b3);
    expect(document.activeElement).toBe(b3);
    fireEvent.click(screen.getByRole('button', { name: '12 mois' }));
    expect(await screen.findByText('2026-05')).toBeTruthy();
    get.mockImplementation(defaultImpl);
  });

  it('R4 — un seul mois avec occurrence suffit à afficher la projection', async () => {
    get.mockImplementation(() => Promise.resolve([month('2026-01', []), month('2026-02')]));
    renderPage();
    expect(await screen.findByText('2026-02')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Déclarations/ })).toBeNull();
    get.mockImplementation(defaultImpl);
  });
});
