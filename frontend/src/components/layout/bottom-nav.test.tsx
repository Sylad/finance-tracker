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

async function renderNav(path = '/') {
  const rootRoute = createRootRoute({ component: () => <BottomNav /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
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
    const expected = [...NAV_ITEMS, ...SECONDARY_ITEMS].map((i) => i.label);
    expect(labels).toEqual(expected);
    expect(labels).toHaveLength(19);
    expect(labels).toContain('Plan de travail');
    expect(screen.getByRole('button', { name: 'Plus' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Décision de revue UX L50 : pages principales D'ABORD (focus sur la première), les trois
  // liens de l'application dans une bande collante en bas du panneau, juste au-dessus de
  // la barre du bas, comme le pied fixe du bureau ; Déconnexion reste dernière de la grille.
  it('L50 : pages principales d’abord, focus sur la première ; Déconnexion en fin de grille ; bande des trois liens ensuite', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const dialog = screen.getByRole('dialog');
    const pages = within(dialog).getByRole('list', { name: 'Pages' });
    expect(within(pages).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(NAV_ITEMS.map((i) => i.label));
    expect(document.activeElement).toBe(within(pages).getByRole('link', { name: 'Tableau de bord' }));

    const scroll = dialog.querySelector('[data-sheet-scroll]') as HTMLElement;
    expect(scroll.className).toMatch(/overflow-y-auto/);
    expect(scroll).toContainElement(pages);
    const logout = within(dialog).getByRole('button', { name: /Déconnexion/ });
    expect(scroll).toContainElement(logout);
    expect(pages.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const band = dialog.querySelector('[data-sheet-band]') as HTMLElement;
    expect(scroll).not.toContainElement(band);
    expect(band.className).toMatch(/shrink-0/);
    expect(band.className).toMatch(/border-t/);
    expect(band.className).toMatch(/bg-surface( |$)/);
    const app = within(band).getByRole('list', { name: 'Application' });
    expect(app.className).toMatch(/grid-cols-3/);
    const cells = within(app).getAllByRole('link');
    expect(cells.map((a) => a.textContent?.trim())).toEqual(SECONDARY_ITEMS.map((i) => i.label));
    for (const cell of cells) {
      // Icône au-dessus d'un libellé de 12 px, cible ≥ 44 px, comme les cases de la barre du bas.
      expect(cell.className).toMatch(/flex-col/);
      expect(cell.className).toMatch(/(^| )min-h-11( |$)/);
      const label = [...cell.querySelectorAll('span')].find((n) => SECONDARY_ITEMS.some((i) => i.label === n.textContent))!;
      expect(label.className).toMatch(/text-\[12px\]/);
      expect(cell.querySelector('svg')!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(logout.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('L50 : ordre clavier = grille puis bande ; aria-current sur la page courante seulement', async () => {
    await renderNav('/plan');
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const dialog = screen.getByRole('dialog');
    const logout = within(dialog).getByRole('button', { name: /Déconnexion/ });
    logout.focus();
    await userEvent.tab();
    expect(document.activeElement).toHaveTextContent('Nouveautés');
    await userEvent.tab();
    expect(document.activeElement).toHaveTextContent('Plan de travail');
    const current = within(dialog).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Plan de travail']);
  });

  it('L50 : à l’accueil, seul « Tableau de bord » porte aria-current', async () => {
    await renderNav('/');
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    const current = within(screen.getByRole('dialog')).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Tableau de bord']);
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
    // Dernier élément du panneau : la dernière case de la bande (À propos).
    const last = within(within(dialog).getByRole('list', { name: 'Application' })).getByRole('link', { name: 'À propos' });
    closeBtn.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
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
