// L50 — Nouveautés, Plan de travail et À propos vivent dans le pied FIXE de la barre
// latérale : toujours visibles au bureau (avec la pastille), quelle que soit la hauteur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    expect(main.className).toMatch(/overflow-y-auto/);
    expect(within(main).getAllByRole('link').map((a) => a.textContent)).toEqual(NAV_ITEMS.map((i) => i.label));
    const app = screen.getByRole('navigation', { name: 'Application' });
    expect(within(app).getAllByRole('link').map((a) => a.textContent)).toEqual(SECONDARY_ITEMS.map((i) => i.label));
    expect(within(app).getByRole('link', { name: 'Plan de travail' })).toHaveAttribute('href', '/plan');
    // Le pied ne rétrécit pas : c'est la liste du haut qui défile.
    expect(app.closest('[data-sidebar-footer]')!.className).toMatch(/shrink-0/);
    expect(main.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
