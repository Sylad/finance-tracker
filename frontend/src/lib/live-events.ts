import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * L16 t2 — flux SSE `/api/events` du backend (EventBusService) → invalidations
 * TanStack Query. Une modification faite ailleurs (autre onglet, synchro
 * automatique après import) rafraîchit les écrans ouverts sans rechargement.
 * Clés par préfixe : `['loans']` couvre aussi `['loans', 'suspicious']`, etc.
 */
export const EVENT_QUERY_KEYS: Record<string, QueryKey[]> = {
  'loans-changed': [['loans'], ['dashboard'], ['health'], ['forecast'], ['goals']],
  'loan-suggestions-changed': [['loan-suggestions']],
  'savings-changed': [['savings'], ['dashboard'], ['health'], ['goals']],
  'goals-changed': [['goals']],
  'subscriptions-changed': [['subscriptions'], ['forecast'], ['health']],
  'declarations-changed': [['declarations'], ['forecast']],
  'category-rules-changed': [['category-rules']],
  'category-rule-suggestions-changed': [['category-rule-suggestions']],
  'import-logs-changed': [['import-logs']],
  'accounts-synced': [
    ['statements'], ['loans'], ['savings'], ['subscriptions'], ['dashboard'],
    ['health'], ['forecast'], ['expenses-breakdown'], ['goals'],
  ],
};

const LOCK_NAME = 'finance-live-events';
const CHANNEL_NAME = 'finance-live-events';
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

export interface LiveEventsEnv {
  locks?: LockManager;
  createChannel?: (name: string) => BroadcastChannel;
}

function browserEnv(): LiveEventsEnv {
  return {
    locks: typeof navigator !== 'undefined' ? navigator.locks : undefined,
    createChannel: typeof BroadcastChannel !== 'undefined' ? (n) => new BroadcastChannel(n) : undefined,
  };
}

/**
 * Une seule connexion SSE par navigateur, pas une par onglet : en HTTP/1.1
 * (local/run.sh, Vite) la limite est de 6 connexions par hôte, et des flux
 * permanents dans chaque onglet bloqueraient les pages et requêtes /api.
 * Le titulaire d'un verrou Web Locks ouvre le flux et relaie les événements
 * aux autres onglets via BroadcastChannel ; s'il se ferme, un autre reprend.
 * Sans ces API, chaque onglet ouvre son propre flux.
 */
export function startLiveEvents(
  qc: QueryClient,
  open: () => EventSource = () => new EventSource('/api/events'),
  env: LiveEventsEnv = browserEnv(),
): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = RETRY_MIN_MS;
  let release: (() => void) | undefined;
  const abort = new AbortController();

  const apply = (type: unknown) => {
    const keys = typeof type === 'string' ? EVENT_QUERY_KEYS[type] : undefined;
    if (!keys) return;
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };

  const channel = env.createChannel?.(CHANNEL_NAME);
  if (channel) channel.onmessage = (e) => apply(e.data);

  const connect = () => {
    if (stopped) return;
    const s = open();
    source = s;
    s.onopen = () => {
      retryMs = RETRY_MIN_MS;
    };
    s.onmessage = (msg) => {
      let type: unknown;
      try {
        type = (JSON.parse(msg.data) as { type?: unknown }).type;
      } catch {
        return;
      }
      apply(type);
      if (typeof type === 'string' && EVENT_QUERY_KEYS[type]) channel?.postMessage(type);
    };
    // CONNECTING : le navigateur retente seul. CLOSED (réponse non-200 à la
    // reconnexion, ex. 502 pendant un redémarrage) : il abandonne pour de bon,
    // donc on rouvre nous-mêmes avec un délai croissant.
    s.onerror = () => {
      if (stopped || s.readyState !== 2) return;
      s.close();
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
  };

  if (env.locks && channel) {
    env.locks
      .request(LOCK_NAME, { signal: abort.signal }, () => {
        if (stopped) return Promise.resolve();
        return new Promise<void>((resolve) => {
          release = resolve;
          connect();
        });
      })
      .catch(() => undefined);
  } else {
    connect();
  }

  return () => {
    stopped = true;
    abort.abort();
    clearTimeout(retryTimer);
    source?.close();
    release?.();
    channel?.close();
  };
}
