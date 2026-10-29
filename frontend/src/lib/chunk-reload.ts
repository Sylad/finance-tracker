// Un navigateur resté sur une ancienne version de la page demande un morceau
// (chunk) de cette version ; une fois la livraison faite, le serveur ne l'a
// plus et répond 404. Plutôt qu'une page figée, on recharge : l'index.html
// revalidé (Cache-Control: no-cache) pointe vers les morceaux de la version
// courante.

const RELOAD_KEY = 'ft_chunk_reload_at';
// Un second échec dans cette fenêtre veut dire que le rechargement n'a rien
// réparé (morceau absent de la version courante aussi) : on cesse de boucler.
const MIN_GAP_MS = 60_000;

const CHUNK_FAILURE = /dynamically imported module|importing a module script failed/i;

export function isChunkLoadFailure(reason: unknown): boolean {
  return reason instanceof Error && CHUNK_FAILURE.test(reason.message);
}

interface Options {
  target: EventTarget;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  reload: () => void;
  now: () => number;
}

export function installChunkReload({ target, storage, reload, now }: Options): void {
  const reloadOnce = (): boolean => {
    let last: number;
    try {
      last = Number(storage.getItem(RELOAD_KEY)) || 0;
      if (now() - last < MIN_GAP_MS) return false;
      storage.setItem(RELOAD_KEY, String(now()));
    } catch {
      // Sans stockage on ne saurait pas qu'on vient de recharger : une boucle
      // de rechargements serait pire que la page figée, on s'abstient.
      return false;
    }
    reload();
    return true;
  };

  target.addEventListener('vite:preloadError', (event) => {
    // Sans rechargement l'erreur reste telle quelle : empêcher l'événement
    // ferait résoudre l'import à `undefined` et masquerait la vraie cause.
    if (reloadOnce()) event.preventDefault();
  });
  target.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadFailure((event as PromiseRejectionEvent).reason)) {
      event.preventDefault();
      reloadOnce();
    }
  });
}
