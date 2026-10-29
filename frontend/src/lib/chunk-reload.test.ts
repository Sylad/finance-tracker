import { describe, expect, it, vi } from 'vitest';
import { installChunkReload, isChunkLoadFailure } from './chunk-reload';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    data,
  };
}

function setup(now = 1_000_000, stored: Record<string, string> = {}) {
  const target = new EventTarget();
  const reload = vi.fn();
  const storage = memoryStorage(stored);
  installChunkReload({ target, storage, reload, now: () => now });
  return { target, reload, storage };
}

function preloadError() {
  const ev = new Event('vite:preloadError', { cancelable: true });
  return ev;
}

function rejection(message: string) {
  const ev = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown };
  ev.reason = new TypeError(message);
  return ev;
}

describe('chunk-reload (un morceau d’une ancienne version répond 404)', () => {
  it('recharge la page quand Vite signale un morceau introuvable, et garde l’erreur muette', () => {
    const { target, reload } = setup();
    const ev = preloadError();
    target.dispatchEvent(ev);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('recharge aussi sur un import dynamique refusé (Chrome, Firefox, Safari)', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/a-AAAAAAAA.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      const { target, reload } = setup();
      target.dispatchEvent(rejection(message));
      expect(reload, message).toHaveBeenCalledTimes(1);
    }
  });

  it('ne recharge pas pour une autre erreur non gérée', () => {
    const { target, reload } = setup();
    target.dispatchEvent(rejection('Network request failed'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('ne recharge qu’une fois par minute : pas de boucle si le morceau manque encore après le rechargement', () => {
    const first = setup(1_000_000);
    first.target.dispatchEvent(preloadError());
    expect(first.reload).toHaveBeenCalledTimes(1);

    const again = setup(1_000_000 + 30_000, first.storage.data);
    again.target.dispatchEvent(preloadError());
    expect(again.reload).not.toHaveBeenCalled();

    const later = setup(1_000_000 + 61_000, first.storage.data);
    later.target.dispatchEvent(preloadError());
    expect(later.reload).toHaveBeenCalledTimes(1);
  });

  it('ne recharge pas (donc ne boucle pas) si le stockage de session est inaccessible, sans lever', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    installChunkReload({ target, storage, reload, now: () => 1_000_000 });
    expect(() => target.dispatchEvent(preloadError())).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it('isChunkLoadFailure reconnaît un message et refuse une valeur qui n’en est pas un', () => {
    expect(isChunkLoadFailure(new TypeError('Failed to fetch dynamically imported module: x'))).toBe(true);
    expect(isChunkLoadFailure('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadFailure(undefined)).toBe(false);
    expect(isChunkLoadFailure(null)).toBe(false);
  });
});
