// L169 — l'écran 404 est en français, a un titre de page et une issue vers le tableau de bord.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { NotFound } from './not-found';

describe('<NotFound /> (L169)', () => {
  it('nomme l’erreur dans un h1 et propose un lien vers le tableau de bord', async () => {
    const router = createRouter({
      routeTree: createRootRoute(),
      defaultNotFoundComponent: NotFound,
      history: createMemoryHistory({ initialEntries: ['/nexiste-pas'] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page introuvable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Revenir au tableau de bord/ })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Not Found')).toBeNull();
  });
});
