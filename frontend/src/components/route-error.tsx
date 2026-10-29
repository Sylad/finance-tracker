import type { ErrorComponentProps } from '@tanstack/react-router';
import { ErrorState } from '@/components/loading-state';

// Écran d'erreur par défaut du routeur (remplace le « Something went wrong! »
// anglais de TanStack). Typiquement : un morceau de page resté absent après le
// rechargement unique de chunk-reload. Recharger la page est la réparation ;
// le détail technique reste dans la console, pas à l'écran.
export function RouteError({ error }: ErrorComponentProps) {
  console.error(error);
  return (
    <div className="mx-auto max-w-md p-6">
      <ErrorState
        title="Cette page n’a pas pu s’afficher"
        message="Une nouvelle version de l’application vient peut-être d’être mise en ligne. Rechargez la page pour la récupérer."
        onRetry={() => window.location.reload()}
        retryLabel="Recharger"
      />
    </div>
  );
}
