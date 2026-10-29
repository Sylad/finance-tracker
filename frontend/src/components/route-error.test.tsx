import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteError } from './route-error';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubReload() {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  return reload;
}

describe('routeur (L164)', () => {
  it('R4 — le routeur utilise RouteError comme écran d’erreur par défaut', async () => {
    const { router } = await import('@/router');
    expect(router.options.defaultErrorComponent).toBe(RouteError);
  });
});

describe('RouteError (L164) — écran d’erreur de route en français', () => {
  it('R1 — affiche un message en français, jamais « Something went wrong »', () => {
    render(<RouteError error={new Error('Failed to fetch dynamically imported module: /assets/x.js')} reset={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Cette page n’a pas pu s’afficher/);
    expect(document.body.textContent).not.toMatch(/Something went wrong|Show Error/i);
  });

  it('R2 — le bouton « Recharger » recharge la page', async () => {
    const reload = stubReload();
    render(<RouteError error={new Error('boom')} reset={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /recharger/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('R3 — ne montre pas le message technique de l’erreur à l’utilisateur', () => {
    render(<RouteError error={new Error('secret-stack-detail')} reset={() => {}} />);
    expect(document.body.textContent).not.toContain('secret-stack-detail');
  });
});
