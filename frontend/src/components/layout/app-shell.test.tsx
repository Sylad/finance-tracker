// L40 — revue UX du gabarit commun : lien d'évitement, titre d'onglet par page, bandeau démo
// annoncé et utilisable au doigt, aucun texte de navigation sous 12 px.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './app-shell';
import { pageTitle } from './page-title';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  document.title = 'Finance Tracker';
});

async function renderShell(path = '/') {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AppShell><p>contenu de la page</p></AppShell> }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText('contenu de la page');
  return router;
}

describe('<AppShell /> (L40)', () => {
  it('R1 — un lien « Aller au contenu » est le premier élément focalisable et mène à <main id="contenu">', async () => {
    await renderShell('/health');
    const skip = screen.getByRole('link', { name: 'Aller au contenu' });
    expect(skip).toHaveAttribute('href', '#contenu');
    const focusables = [...document.querySelectorAll<HTMLElement>('a[href], button')];
    expect(focusables[0]).toBe(skip);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'contenu');
    expect(main).toHaveAttribute('tabindex', '-1');
    fireEvent.click(skip);
    expect(document.activeElement).toBe(main);
  });

  it('R2 — le titre de l’onglet nomme la page courante, y compris après un changement de page', async () => {
    const router = await renderShell('/loans');
    expect(document.title).toBe('Crédits — Finance Tracker');
    await act(async () => { await router.navigate({ to: '/about' as never }); });
    expect(document.title).toBe('À propos — Finance Tracker');
  });

  it('R2 — pageTitle : page principale, secondaire, sous-page, page inconnue', () => {
    expect(pageTitle('/')).toBe('Tableau de bord — Finance Tracker');
    expect(pageTitle('/plan')).toBe('Plan de travail — Finance Tracker');
    expect(pageTitle('/history/2026-03')).toBe('Historique — Finance Tracker');
    expect(pageTitle('/inconnue')).toBe('Finance Tracker');
  });

  it('R3 — le bandeau démo (forcé) est annoncé en role=status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ forced: true, seeded: true, available: true }) })));
    await renderShell();
    const banner = await screen.findByRole('status');
    expect(banner).toHaveAttribute('data-demo-banner');
    expect(banner.textContent).toMatch(/Mode démo/);
  });

  it('R3 — hors démo forcée, « Quitter » est un bouton d’au moins 44 px (min-h-11)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ forced: false, seeded: true, available: true }) })));
    sessionStorage.setItem('demoMode', 'true');
    await renderShell();
    const quit = await within(await screen.findByRole('status')).findByRole('button', { name: 'Quitter' });
    expect(quit.className).toMatch(/min-h-11/);
  });

  it('R4 — aucun texte de navigation sous 12 px dans la barre latérale et la barre du bas', async () => {
    await renderShell();
    const roots = [document.querySelector('aside'), document.querySelector('nav[aria-label="Navigation principale"]')] as HTMLElement[];
    for (const root of roots) {
      const small = [...root.querySelectorAll<HTMLElement>('[class*="text-[10px]"], [class*="text-[11px]"]')]
        .filter((el) => !el.hasAttribute('data-news-badge') && !el.closest('kbd'));
      expect(small.map((e) => e.textContent)).toEqual([]);
    }
  });
});
