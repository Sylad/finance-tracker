import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * L16 t2 — flux SSE `/api/events` du backend (EventBusService) → invalidations
 * TanStack Query. Une modification faite ailleurs (autre onglet, synchro
 * automatique après import) rafraîchit les écrans ouverts sans rechargement.
 * Clés par préfixe : `['loans']` couvre aussi `['loans', 'suspicious']`, etc.
 *
 * TABLE DE RÉFÉRENCE (revue exhaustive L16, 2026-10-14) — à refaire à chaque
 * nouvel événement `bus.emit` ou nouvelle clé de requête, pas écran par écran.
 *
 * Clé (endpoint) ← sources lues côté backend :
 *   statements      (/statements, score-history, recurring-credits, yearly, heatmap) ← relevés
 *   statement       (singulier : ['statement', id, 'anomalies']) ← relevés N et N-1
 *   loans           (/loans, duplicates, suspicious) ← crédits ; suspicious lit aussi les relevés
 *   loan-suggestions ← suggestions de crédit
 *   savings         (/savings-accounts, historique) ← épargne
 *   subscriptions   (/subscriptions, duplicates) ← abonnements
 *   declarations    ← échéances
 *   forecast        ← échéances + crédits + abonnements + relevés (revenus récurrents)
 *   dashboard       (net-worth, alerts, yearly) ← épargne + crédits + relevés
 *   health          (diagnostic, thresholds, advice) ← relevés + crédits + abonnements + épargne + seuils
 *   goals           ← objectifs + épargne + crédits + relevés (progression calculée dessus)
 *   expenses-breakdown ← relevés + crédits + abonnements + épargne (collectAllocatedTxIds)
 *   category-rules, category-rule-suggestions, import-logs ← leur propre stockage
 *   Sans événement : budgets (mutation locale), demo/status, plan, news.
 *
 * Événement → clés (une clé par source modifiée ci-dessus) :
 *   loans-changed        loans, dashboard, health, forecast, goals, expenses-breakdown (pas savings/subscriptions)
 *   savings-changed      savings, dashboard, health, goals, expenses-breakdown (pas forecast : ne lit pas l'épargne)
 *   subscriptions-changed subscriptions, forecast, health, expenses-breakdown (pas dashboard/goals)
 *   declarations-changed declarations, forecast (seul forecast les lit)
 *   goals-changed        goals
 *   loan-suggestions-changed loan-suggestions
 *   category-rules-changed category-rules
 *   category-rule-suggestions-changed category-rule-suggestions
 *   import-logs-changed  import-logs
 *   accounts-synced      relevés + crédits + épargne + abonnements + suggestions de crédit touchés
 *                        par la synchro => tout ce qui les lit : statements, statement, loans, savings,
 *                        subscriptions, loan-suggestions, dashboard, health, forecast,
 *                        expenses-breakdown, goals
 *
 * Reconnexion (L70) : le flux ne rejoue rien, donc après une erreur, à la
 * réouverture suivante, TOUTES les clés ci-dessus sont invalidées (une fois
 * chacune) et le rattrapage est relayé aux autres onglets. Pas à la 1re ouverture.
 *
 * Écritures de relevés SANS événement (recatégorisation, rejeu des règles,
 * revenu exceptionnel) : aucune invalidation possible ici, rechargement requis.
 */
export const EVENT_QUERY_KEYS: Record<string, QueryKey[]> = {
  'loans-changed': [['loans'], ['dashboard'], ['health'], ['forecast'], ['goals'], ['expenses-breakdown']],
  'loan-suggestions-changed': [['loan-suggestions']],
  'savings-changed': [['savings'], ['dashboard'], ['health'], ['goals'], ['expenses-breakdown']],
  'goals-changed': [['goals']],
  'subscriptions-changed': [['subscriptions'], ['forecast'], ['health'], ['expenses-breakdown']],
  'declarations-changed': [['declarations'], ['forecast']],
  'category-rules-changed': [['category-rules']],
  'category-rule-suggestions-changed': [['category-rule-suggestions']],
  'import-logs-changed': [['import-logs']],
  'accounts-synced': [
    ['statements'], ['statement'], ['loans'], ['savings'], ['subscriptions'], ['loan-suggestions'],
    ['dashboard'], ['health'], ['forecast'], ['expenses-breakdown'], ['goals'],
  ],
};

// Message de canal (hors EVENT_QUERY_KEYS) : rattrapage complet après coupure.
const RESYNC = 'resync';

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
  // Une erreur a eu lieu depuis la dernière ouverture : des événements ont pu
  // être perdus pendant la coupure (le flux ne rejoue rien).
  let hadError = false;
  let release: (() => void) | undefined;
  const abort = new AbortController();

  const invalidateAll = () => {
    const seen = new Set<string>();
    for (const keys of Object.values(EVENT_QUERY_KEYS)) {
      for (const queryKey of keys) {
        const id = JSON.stringify(queryKey);
        if (seen.has(id)) continue;
        seen.add(id);
        void qc.invalidateQueries({ queryKey });
      }
    }
  };

  const apply = (type: unknown) => {
    if (type === RESYNC) return invalidateAll();
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
      if (!hadError) return;
      hadError = false;
      invalidateAll();
      channel?.postMessage(RESYNC);
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
      if (stopped) return;
      hadError = true;
      if (s.readyState !== 2) return;
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
