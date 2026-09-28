/**
 * État d'affichage du tableau de bord selon la requête des relevés (L21/t4).
 * Une erreur d'API ne doit jamais retomber sur l'état vide « Aucun relevé…
 * Importer mon premier relevé » : ce serait mentir sur les données.
 */
export type DashboardView = 'loading' | 'error' | 'empty' | 'ready';

export function dashboardView(q: { isLoading: boolean; isError: boolean; data: unknown[] | undefined }): DashboardView {
  if (q.isLoading) return 'loading';
  if (q.data && q.data.length > 0) return 'ready';
  if (q.isError) return 'error';
  return 'empty';
}
