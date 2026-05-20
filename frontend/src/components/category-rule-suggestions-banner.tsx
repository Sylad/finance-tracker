import { useState } from 'react';
import { Sparkles, Loader2, Eye, EyeOff } from 'lucide-react';
import {
  useCategoryRuleSuggestions,
  useGenerateCategorySuggestions,
  useAcceptCategorySuggestion,
  useRejectCategorySuggestion,
  useSnoozeCategorySuggestion,
} from '@/lib/queries';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { cn } from '@/lib/utils';

const BUILTIN: TransactionCategory[] = [
  'income', 'housing', 'transport', 'food', 'health',
  'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
];

function labelForCategory(cat: string): string {
  if ((BUILTIN as string[]).includes(cat)) return CATEGORY_LABELS[cat as TransactionCategory];
  return cat;
}

/**
 * Banner sur la page /category-rules : propose à l'utilisateur de générer des
 * suggestions de règles regex via Claude pour les transactions actuellement
 * classées `other`. Une fois acceptée, la suggestion devient une CategoryRule
 * persistante (qui s'appliquera aux futurs imports + via le bouton Rejouer).
 */
export function CategoryRuleSuggestionsBanner() {
  const { data } = useCategoryRuleSuggestions();
  const generate = useGenerateCategorySuggestions();
  const accept = useAcceptCategorySuggestion();
  const reject = useRejectCategorySuggestion();
  const snooze = useSnoozeCategorySuggestion();
  const [showHidden, setShowHidden] = useState(false);

  const pending = (data ?? []).filter((s) => s.status === 'pending');
  const snoozed = (data ?? []).filter((s) => s.status === 'snoozed');

  return (
    <div className="card p-4 mb-6 border-l-4 border-l-accent-bright">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-bright shrink-0" />
          <div className="font-display font-semibold text-fg-bright">
            Suggestions Claude — catégoriser les <code className="text-accent-bright">other</code>
          </div>
          {pending.length > 0 && (
            <span className="text-xs text-fg-muted tabular">
              ({pending.length} en attente)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {snoozed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((s) => !s)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border',
                showHidden
                  ? 'bg-accent/10 border-accent/30 text-accent-bright'
                  : 'bg-surface-2 border-border text-fg-muted hover:text-fg-bright',
              )}
            >
              {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showHidden ? 'Masquer' : 'Voir'} les masqués ({snoozed.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            {generate.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generate.isPending ? 'Analyse…' : 'Analyser les other'}
          </button>
        </div>
      </div>

      {generate.isSuccess && generate.data && (
        <div className="mb-3 p-2 rounded bg-positive/10 border border-positive/30 text-xs">
          {generate.data.created > 0
            ? `${generate.data.created} nouvelle${generate.data.created > 1 ? 's' : ''} suggestion${generate.data.created > 1 ? 's' : ''} sur ${generate.data.otherSeen} transactions analysées.`
            : `Aucune nouvelle règle proposée (${generate.data.otherSeen} transactions analysées).`}
        </div>
      )}

      {pending.length === 0 && !generate.isPending && !generate.isSuccess && (
        <p className="text-xs text-fg-muted">
          Clique <strong>Analyser les other</strong> pour que Claude regroupe tes transactions
          non catégorisées et propose des règles regex à valider.
        </p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((s) => (
            <div
              key={s.id}
              className="p-3 bg-surface-2/40 rounded border border-border/40"
            >
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <code className="text-sm text-accent-bright font-mono">
                      /{s.pattern}/i
                    </code>
                    <span className="text-fg-dim text-xs">→</span>
                    <span className="text-sm text-fg-bright font-medium">
                      {labelForCategory(s.category)}
                    </span>
                    {s.subcategory && (
                      <span className="text-xs text-fg-muted">· {s.subcategory}</span>
                    )}
                    <span className="text-xs text-fg-dim tabular">
                      · {s.occurrenceCount} occurrence{s.occurrenceCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  {s.rationale && (
                    <p className="text-xs text-fg-muted mt-1">{s.rationale}</p>
                  )}
                  {s.exampleDescriptions.length > 0 && (
                    <ul className="text-xs text-fg-dim mt-1.5 space-y-0.5">
                      {s.exampleDescriptions.slice(0, 3).map((ex, i) => (
                        <li key={i} className="font-mono truncate">→ {ex}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => accept.mutate(s.id)}
                    disabled={accept.isPending}
                    className="btn-primary text-xs"
                  >
                    Accepter
                  </button>
                  <button
                    onClick={() => snooze.mutate(s.id)}
                    disabled={snooze.isPending}
                    className="btn-ghost text-xs"
                  >
                    Plus tard
                  </button>
                  <button
                    onClick={() => reject.mutate(s.id)}
                    disabled={reject.isPending}
                    className="btn-ghost text-xs hover:text-negative"
                  >
                    Rejeter
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showHidden && snoozed.length > 0 && (
        <div className="space-y-2 mt-3 pt-3 border-t border-border/40">
          {snoozed.map((s) => (
            <div
              key={s.id}
              className="p-2 bg-surface-2/20 rounded opacity-70 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <code className="text-xs text-fg-muted font-mono truncate">
                  /{s.pattern}/i → {labelForCategory(s.category)}
                </code>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => accept.mutate(s.id)}
                  className="btn-ghost text-xs"
                >
                  Accepter
                </button>
                <button
                  onClick={() => reject.mutate(s.id)}
                  className="btn-ghost text-xs hover:text-negative"
                >
                  Rejeter
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
