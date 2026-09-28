import { describe, expect, it } from 'vitest';
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

async function renderNav() {
  const rootRoute = createRootRoute({ component: () => <BottomNav /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
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
    expect(labels).toHaveLength(18);
    expect(screen.getByRole('button', { name: 'Plus' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('choisir une page ferme la liste', async () => {
    await renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Crédits/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
