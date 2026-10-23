import { Sparkles } from 'lucide-react';
import { useLoanSuggestions } from '@/lib/queries';
import { SUGGESTIONS_BANNER_ID } from './suggestions-banner';
import { pendingLoanSuggestions } from './utils';

/** Bandeau sous l'en-tête de /loans : la suggestion en attente est sinon tout en bas de la page. */
export function PendingSuggestionsSignal() {
  const { data } = useLoanSuggestions();
  const count = pendingLoanSuggestions(data).length;
  if (count === 0) return null;
  const goToBanner = () => {
    const target = document.getElementById(SUGGESTIONS_BANNER_ID);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  };
  return (
    <button
      type="button"
      onClick={goToBanner}
      className="card flex w-full items-center gap-2 p-3 mb-6 border-l-4 border-l-warning text-left text-sm font-medium text-fg-bright hover:bg-surface-2/40"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      {count} suggestion{count > 1 ? 's' : ''} à valider
      <span className="ml-auto text-xs font-normal text-fg-dim">Voir ↓</span>
    </button>
  );
}
