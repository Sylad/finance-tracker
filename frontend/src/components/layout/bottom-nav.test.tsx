import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { BottomNav } from './bottom-nav';
import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';

// L47 : la barre lit le journal des Nouveautés (pastille) ; ici, aucun journal.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })));
});
afterEach(() => vi.unstubAllGlobals());

async function renderNav() {
  const rootRoute = createRootRoute({ component: () => <BottomNav /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen.findByRole('navigation', { name: 'Navigation principale' });
}

describe('<BottomNav /> (L21/t8)', () => {
  it('5 onglets, le 5e est « Plus »', async () => {
    const nav = await renderNav();
    const tabs = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(tabs).toHaveLength(4);
    const plus = within(nav).getByRole('button', { name: 'Plus' });
    expect(plus).toHaveAttribute('aria-expanded', 'false');
  });

  it('« Plus » ouvre la liste complète des pages, Échap la ferme', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const dialog = screen.getByRole('dialog', { name: 'Toutes les pages' });
    const labels = within(dialog).getAllByRole('link').map((a) => a.textContent?.trim());
    const expected = [...SECONDARY_ITEMS, ...NAV_ITEMS].map((i) => i.label);
    expect(labels).toEqual(expected);
    expect(labels).toHaveLength(19);
    expect(labels).toContain('Plan de travail');
    expect(screen.getByRole('button', { name: 'Plus' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('L50 : Nouveautés, Plan de travail et À propos en tête du panneau, focus sur Nouveautés', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const app = within(screen.getByRole('dialog')).getByRole('list', { name: 'Application' });
    expect(within(app).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Nouveautés', 'Plan de travail', 'À propos']);
    expect(document.activeElement).toBe(within(app).getByRole('link', { name: 'Nouveautés' }));
  });

  it('choisir une page ferme la liste', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Crédits/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('piège le focus dans le panneau (Tab et Maj+Tab bouclent)', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const dialog = screen.getByRole('dialog');
    const focusables = within(dialog).getAllByRole('button').concat(within(dialog).getAllByRole('link'));
    // 1er focus : première page ; Maj+Tab depuis le premier élément du panneau → dernier.
    const closeBtn = within(dialog).getByRole('button', { name: 'Fermer' });
    const logout = within(dialog).getByRole('button', { name: /Déconnexion/ });
    closeBtn.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(logout);
    await userEvent.tab();
    expect(document.activeElement).toBe(closeBtn);
    expect(focusables.length).toBeGreaterThan(19);
  });

  it.each([
    ['Échap', async () => { await userEvent.keyboard('{Escape}'); }],
    ['bouton Fermer', async () => { await userEvent.click(screen.getByRole('button', { name: 'Fermer' })); }],
    ['voile', async () => { await userEvent.click(screen.getByTestId('all-pages-backdrop')); }],
    ['choix d’une page', async () => { await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Crédits/ })); }],
  ])('rend le focus au bouton « Plus » à la fermeture (%s)', async (_n, closeIt) => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    await closeIt();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plus' }));
  });

  it("le voile passe au-dessus de l'en-tête téléphone (z-40) et sous la barre (z-50)", async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    expect(screen.getByTestId('all-pages-overlay').className).toContain('z-[45]');
  });

  it('libellés français : « Tableau de bord », plus de « Dashboard » (L21/t11)', async () => {
    const nav = await renderNav();
    expect(within(nav).getAllByRole('link')[0]).toHaveAccessibleName('Tableau de bord');
    expect(NAV_ITEMS[0].label).toBe('Tableau de bord');
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Tableau de bord' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Dashboard/);
  });
});
