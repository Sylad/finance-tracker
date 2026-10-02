// L47 — pastille « nouveau » sur le lien Nouveautés (barre latérale, « Plus » et son
// panneau au téléphone). Porté des tests de navigation d'ol-companion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { BottomNav } from './bottom-nav';
import { Sidebar } from './sidebar';
import { NEWS_SEEN_EVENT, NEWS_SEEN_KEY } from '@/lib/news-badge';

const NEWS = {
  project: 'finance-tracker',
  generated: '2026-10-01 22:00',
  entries: [
    { slug: 'c', title: 'C', date: '2026-10-01', lots: [], captures: [], html: '' },
    { slug: 'b', title: 'B', date: '2026-09-30', lots: [], captures: [], html: '' },
    { slug: 'a', title: 'A', date: '2026-09-28', lots: [], captures: [], html: '' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/nouveautes.json')
        ? { ok: true, status: 200, json: async () => NEWS }
        : { ok: false, status: 404, json: async () => null },
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Visite ancienne qui n'a vu que l'entrée « a » : deux nouveautés non vues. */
const seenOnlyOldest = () =>
  localStorage.setItem(
    NEWS_SEEN_KEY,
    JSON.stringify({ date: '2026-09-28', slugs: ['a'], seen: ['a'], at: '2026-09-28T08:00:00.000Z' }),
  );

async function renderAt(path: string, Component: () => JSX.Element) {
  const rootRoute = createRootRoute({ component: Component });
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
  await screen.findAllByRole('link');
  return router;
}

describe('pastille « nouveau » (L47)', () => {
  it('premier visiteur : aucune pastille, ni au bureau ni au téléphone', async () => {
    await renderAt('/', () => (
      <>
        <Sidebar />
        <BottomNav />
      </>
    ));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelectorAll('[data-news-badge]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Plus' })).toBeInTheDocument();
  });

  it('nouveau venu : ligne de base mémorisée sans instant de visite ; une entrée publiée ensuite → pastille 1', async () => {
    await renderAt('/', () => <Sidebar />);
    await waitFor(() => expect(localStorage.getItem(NEWS_SEEN_KEY)).not.toBeNull());
    const base = JSON.parse(localStorage.getItem(NEWS_SEEN_KEY)!);
    expect(base.seen).toEqual(['a', 'b', 'c']);
    expect(base.at).toBeUndefined();
    expect(document.querySelectorAll('[data-news-badge]')).toHaveLength(0);
    cleanup();

    NEWS.entries.unshift({ slug: 'd', title: 'D', date: '2026-10-02', lots: [], captures: [], html: '' });
    try {
      await renderAt('/', () => <Sidebar />);
      expect(await screen.findByRole('link', { name: 'Nouveautés (1 nouveauté non vue)' })).toBeInTheDocument();
    } finally {
      NEWS.entries.shift();
    }
  });

  it('mémoire existante jamais écrasée par la ligne de base', async () => {
    seenOnlyOldest();
    const before = localStorage.getItem(NEWS_SEEN_KEY);
    await renderAt('/', () => <Sidebar />);
    await screen.findByRole('link', { name: 'Nouveautés (2 nouveautés non vues)' });
    expect(localStorage.getItem(NEWS_SEEN_KEY)).toBe(before);
  });

  it('bureau : nombre d’entrées non vues sur le lien, dit en toutes lettres ; pastille de 16 px (ligne inchangée)', async () => {
    seenOnlyOldest();
    await renderAt('/', () => <Sidebar />);
    const link = await screen.findByRole('link', { name: 'Nouveautés (2 nouveautés non vues)' });
    const badge = link.querySelector('[data-news-badge]')!;
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge.className).toMatch(/(^| )h-4( |$)/);
    expect(badge.className).toMatch(/(^| )min-w-4( |$)/);
  });

  it('« 9+ » au-delà de neuf', async () => {
    localStorage.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2020-01-01', slugs: [], seen: [] }));
    const many = Array.from({ length: 12 }, (_, i) => ({ slug: `n${i}`, title: `N${i}`, date: '2026-09-01', lots: [], captures: [], html: '' }));
    const saved = NEWS.entries;
    NEWS.entries = many;
    try {
      await renderAt('/', () => <Sidebar />);
      const link = await screen.findByRole('link', { name: 'Nouveautés (12 nouveautés non vues)' });
      expect(link.querySelector('[data-news-badge]')).toHaveTextContent('9+');
    } finally {
      NEWS.entries = saved;
    }
  });

  it('téléphone : « Plus » et le lien Nouveautés du panneau portent la pastille', async () => {
    seenOnlyOldest();
    const user = userEvent.setup();
    await renderAt('/', () => <BottomNav />);
    const plus = await screen.findByRole('button', { name: 'Plus (2 nouveautés non vues)' });
    expect(plus.querySelector('[data-news-badge]')).toHaveTextContent('2');
    await user.click(plus);
    const dialog = screen.getByRole('dialog', { name: 'Toutes les pages' });
    const link = within(dialog).getByRole('link', { name: 'Nouveautés (2 nouveautés non vues)' });
    expect(link.querySelector('[data-news-badge]')).toHaveTextContent('2');
    expect(within(dialog).getByRole('link', { name: 'Plan de travail' })).toHaveAttribute('href', '/plan');
  });

  it('la pastille s’éteint dès que la page Nouveautés a marqué tout vu (événement), et entre onglets (storage)', async () => {
    seenOnlyOldest();
    await renderAt('/', () => <Sidebar />);
    await screen.findByRole('link', { name: 'Nouveautés (2 nouveautés non vues)' });
    act(() => {
      localStorage.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-10-01', slugs: ['c'], seen: ['a', 'b', 'c'] }));
      window.dispatchEvent(new Event(NEWS_SEEN_EVENT));
    });
    expect(screen.getByRole('link', { name: 'Nouveautés' })).not.toContainHTML('data-news-badge');
    act(() => {
      localStorage.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-09-30', slugs: ['b'], seen: ['a', 'b'] }));
      window.dispatchEvent(new StorageEvent('storage', { key: NEWS_SEEN_KEY }));
    });
    expect(screen.getByRole('link', { name: 'Nouveautés (1 nouveauté non vue)' })).toBeInTheDocument();
  });

  it('stockage inaccessible : la navigation s’affiche sans pastille ni erreur', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      await renderAt('/', () => <Sidebar />);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.getByRole('link', { name: 'Nouveautés' })).toBeInTheDocument();
      expect(document.querySelectorAll('[data-news-badge]')).toHaveLength(0);
    } finally {
      spy.mockRestore();
      spySet.mockRestore();
    }
  });
});
