// L50 — Nouveautés, Plan de travail et À propos vivent dans le pied FIXE de la barre
// latérale : toujours visibles au bureau (avec la pastille), quelle que soit la hauteur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { NAV_ITEMS, SECONDARY_ITEMS, Sidebar } from './sidebar';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })));
});
afterEach(() => vi.unstubAllGlobals());

async function renderSidebar() {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Sidebar /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findAllByRole('link');
}

describe('<Sidebar /> (L50)', () => {
  it('pages de l’application dans la zone qui défile, Nouveautés · Plan de travail · À propos dans le pied fixe', async () => {
    await renderSidebar();
    const main = screen.getByRole('navigation', { name: 'Pages' });
    expect(main.closest('[data-sidebar-scroll]')!.className).toMatch(/overflow-y-auto/);
    expect(within(main).getAllByRole('link').map((a) => a.textContent)).toEqual(NAV_ITEMS.map((i) => i.label));
    const app = screen.getByRole('navigation', { name: 'Application' });
    expect(within(app).getAllByRole('link').map((a) => a.textContent)).toEqual(SECONDARY_ITEMS.map((i) => i.label));
    expect(within(app).getByRole('link', { name: 'Plan de travail' })).toHaveAttribute('href', '/plan');
    // Le pied ne rétrécit pas : c'est la liste du haut qui défile.
    expect(app.closest('[data-sidebar-footer]')!.className).toMatch(/shrink-0/);
    expect(main.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Revue UX L50 : pied fixe trop haut (213 px + bande de version) → 8 pages sur 16 à
  // 1280×720. Le pied fixe ne garde que les trois liens et Déconnexion.
  it('pied fixe : les trois liens et Déconnexion seulement ; recherche rapide et version en fin de liste qui défile', async () => {
    await renderSidebar();
    const footer = document.querySelector('[data-sidebar-footer]') as HTMLElement;
    expect(within(footer).getAllByRole('link').map((a) => a.textContent)).toEqual(SECONDARY_ITEMS.map((i) => i.label));
    expect(within(footer).getAllByRole('button').map((b) => b.textContent)).toEqual(['Déconnexion']);
    expect(footer.textContent).not.toMatch(/Recherche rapide|v2\.0/);
    // Rien d'autre sous le pied : il est le dernier enfant de la barre.
    expect(footer.nextElementSibling).toBeNull();

    const scroller = screen.getByRole('navigation', { name: 'Pages' }).closest('[data-sidebar-scroll]') as HTMLElement;
    expect(scroller.className).toMatch(/overflow-y-auto/);
    const search = within(scroller).getByRole('button', { name: /Recherche rapide/ });
    expect(search).toHaveAttribute('title', 'Ouvrir la recherche rapide (⌘K / Ctrl+K)');
    expect(within(scroller).getByText('v2.0')).toBeInTheDocument();
    const lastPage = within(screen.getByRole('navigation', { name: 'Pages' })).getAllByRole('link').at(-1)!;
    expect(lastPage.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const open = vi.fn();
    window.addEventListener('finance:open-command-palette', open);
    search.click();
    expect(open).toHaveBeenCalledTimes(1);
    window.removeEventListener('finance:open-command-palette', open);
  });

  it('fondu en bas de la liste quand elle peut encore défiler, jamais une fois au bout', async () => {
    await renderSidebar();
    const scroller = document.querySelector('[data-sidebar-scroll]') as HTMLElement;
    const fade = () => screen.getByTestId('sidebar-scroll-fade');
    expect(fade()).toHaveAttribute('aria-hidden', 'true');
    expect(fade().className).toMatch(/pointer-events-none/);
    const geometry = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
      Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true });
      scroller.scrollTop = scrollTop;
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
    };
    geometry(800, 400, 0);
    expect(fade()).toHaveAttribute('data-visible', 'true');
    geometry(800, 400, 200);
    expect(fade()).toHaveAttribute('data-visible', 'true');
    geometry(800, 400, 400);
    expect(fade()).toHaveAttribute('data-visible', 'false');
    // Tout tient : pas de fondu.
    geometry(400, 400, 0);
    expect(fade()).toHaveAttribute('data-visible', 'false');
    // Redimensionnement de la fenêtre : recalculé.
    Object.defineProperty(scroller, 'scrollHeight', { value: 900, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(fade()).toHaveAttribute('data-visible', 'true');
  });
});
