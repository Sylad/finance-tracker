import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * L16 t2 — flux SSE `/api/events` du backend (EventBusService) → invalidations
 * TanStack Query. Une modification faite ailleurs (autre onglet, synchro
 * automatique après import) rafraîchit les écrans ouverts sans rechargement.
 * Clés par préfixe : `['loans']` couvre aussi `['loans', 'suspicious']`, etc.
 */
export const EVENT_QUERY_KEYS: Record<string, QueryKey[]> = {
  'loans-changed': [['loans'], ['dashboard'], ['health'], ['forecast']],
  'loan-suggestions-changed': [['loan-suggestions']],
  'savings-changed': [['savings'], ['dashboard'], ['health']],
  'goals-changed': [['goals']],
  'subscriptions-changed': [['subscriptions']],
  'declarations-changed': [['declarations']],
  'category-rules-changed': [['category-rules']],
  'category-rule-suggestions-changed': [['category-rule-suggestions']],
  'import-logs-changed': [['import-logs']],
  'accounts-synced': [
    ['statements'], ['loans'], ['savings'], ['subscriptions'], ['dashboard'],
    ['health'], ['forecast'], ['expenses-breakdown'],
  ],
};

export function startLiveEvents(
  qc: QueryClient,
  open: () => EventSource = () => new EventSource('/api/events'),
): () => void {
  const source = open();
  source.onmessage = (msg) => {
    let type: unknown;
    try {
      type = (JSON.parse(msg.data) as { type?: unknown }).type;
    } catch {
      return;
    }
    const keys = typeof type === 'string' ? EVENT_QUERY_KEYS[type] : undefined;
    if (!keys) return;
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
  // EventSource se reconnecte seul après une coupure : rien à gérer dans onerror.
  return () => source.close();
}
