import { useState } from 'react';
import { EyeOff, RotateCcw } from 'lucide-react';
import { useLoanSuggestions, useRejectSuggestion, useSnoozeSuggestion, useUnsnoozeSuggestion } from '@/lib/queries';
import type { LoanSuggestion } from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';

export function SuggestionsBanner({ onAccept }: { onAccept: (s: LoanSuggestion) => void }) {
  const { data } = useLoanSuggestions();
  const reject = useRejectSuggestion();
  const snooze = useSnoozeSuggestion();
  const unsnooze = useUnsnoozeSuggestion();
  const [showHidden, setShowHidden] = useState(false);
  // Cette page concerne les CRÉDITS uniquement.
  // Les suggestions de type subscription/utility appartiennent à la page /subscriptions.
  const items = (data ?? []).filter((s) => s.status === 'pending' && s.suggestedType === 'loan');
  const hidden = (data ?? []).filter((s) => s.status === 'snoozed' && s.suggestedType === 'loan');
  if (items.length === 0 && hidden.length === 0) return null;
  return (
    <div className="card p-4 mb-6 border-l-4 border-l-warning">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="font-display font-semibold text-fg-bright">
          Suggestions de Claude ({items.length})
        </div>
        {hidden.length > 0 && (
          <button
            onClick={() => setShowHidden((s) => !s)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border',
              showHidden ? 'bg-accent/10 border-accent/30 text-accent-bright' : 'bg-surface-2 border-border text-fg-muted hover:text-fg-bright',
            )}
          >
            <EyeOff className="h-3 w-3" />
            {showHidden ? 'Masquer' : 'Voir'} les masqués ({hidden.length})
          </button>
        )}
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 p-2 bg-surface-2/40 rounded flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg-bright truncate">{s.label}</div>
              <div className="text-xs text-fg-dim tabular">
                {formatEUR(s.monthlyAmount)}/mois · vu {s.occurrencesSeen} fois · type {s.suggestedType}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => onAccept(s)} className="btn-primary text-xs">C'est un crédit</button>
              <button onClick={() => snooze.mutate(s.id)} className="btn-ghost text-xs">Plus tard</button>
              <button onClick={() => reject.mutate(s.id)} className="btn-ghost text-xs hover:text-negative">Pas un crédit</button>
            </div>
          </div>
        ))}
        {showHidden && hidden.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 p-2 bg-surface-2/20 rounded flex-wrap opacity-70">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg-bright truncate">{s.label}</div>
              <div className="text-xs text-fg-dim tabular">
                {formatEUR(s.monthlyAmount)}/mois · vu {s.occurrencesSeen} fois · masqué
              </div>
            </div>
            <button
              onClick={() => unsnooze.mutate(s.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-info/10 hover:bg-info/20 text-info text-xs font-medium border border-info/30"
            >
              <RotateCcw className="h-3 w-3" /> Réafficher
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
