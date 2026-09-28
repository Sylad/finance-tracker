/**
 * État d'affichage du tableau de bord selon la requête des relevés (L21/t4).
 * Une erreur d'API ou une requête en pause hors ligne ne doit jamais
 * retomber sur l'état vide « Aucun relevé… Importer mon premier relevé » :
 * ce serait mentir sur les données. On raisonne sur `isPending` (pas de
 * données) et non sur `isLoading` (= isPending && isFetching en TanStack
 * Query v5), faux quand la requête est en pause hors ligne.
 */
export type DashboardView = 'loading' | 'offline' | 'error' | 'empty' | 'ready';

export function dashboardView(q: {
  isPending: boolean;
  isError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  data: unknown[] | undefined;
}): DashboardView {
  if (q.data && q.data.length > 0) return 'ready';
  if (q.isError) return 'error';
  if (q.isPending) return q.fetchStatus === 'paused' ? 'offline' : 'loading';
  return 'empty';
}
