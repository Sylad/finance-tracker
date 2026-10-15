import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { CATEGORY_LABELS, type Transaction, type TransactionCategory } from '@/types/api';
import { cn } from '@/lib/utils';
import { frenchHint } from '@/lib/category-label';
import { merchantKey } from '@/lib/merchant-key';

interface CategoryRulesPayload {
  rules: Array<{ id: string; pattern: string; category: string; subcategory: string; priority: number }>;
  userCategories: Array<{ id: string; name: string }>;
  availableCategories: string[];
}

interface Props {
  statementId: string;
  tx: Transaction;
  onClose: () => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function CategoryPicker({ statementId, tx, onClose }: Props) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>(tx.category);
  const [subcategory, setSubcategory] = useState<string>(tx.subcategory);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  // L75 : un seul choix de règle (createRule l'emporterait seul côté API, R16) ;
  // par défaut la mémorisation par marchand, sauf clé vide (R14).
  const key = merchantKey(tx.normalizedDescription || tx.description || '');
  const [ruleMode, setRuleMode] = useState<'none' | 'memorize' | 'pattern'>(key ? 'memorize' : 'none');
  const memorize = ruleMode === 'memorize';
  const createRule = ruleMode === 'pattern';
  const [replayAll, setReplayAll] = useState(false);
  const [pattern, setPattern] = useState(escapeRegex(tx.normalizedDescription || tx.description));

  const { data, isLoading } = useQuery<CategoryRulesPayload>({
    queryKey: ['category-rules'],
    queryFn: () => api.get<CategoryRulesPayload>('/category-rules'),
  });

  const addCategory = useMutation({
    mutationFn: (name: string) => api.post('/category-rules/user-categories', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });

  const patchTx = useMutation({
    mutationFn: () => api.patch(`/statements/${statementId}/transactions/${tx.id}/category`, {
      category,
      subcategory,
      createRule,
      memorizeMerchant: memorize,
      rulePattern: createRule ? pattern : undefined,
      replayAll: (createRule || memorize) && replayAll,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statement'] });
      qc.invalidateQueries({ queryKey: ['category-rules'] });
      qc.invalidateQueries({ queryKey: ['statements'] });
      onClose();
    },
  });

  const firstCategory = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstCategory.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const builtins: TransactionCategory[] = [
    'income', 'housing', 'transport', 'food', 'health',
    'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
  ];
  const userCats = data?.userCategories ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        className="card max-w-lg w-full p-6 relative max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Fermer" className="absolute top-3 right-3 text-fg-muted hover:text-fg">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="mb-4">
          <div id="picker-title" className="stat-label">Catégoriser</div>
          <div className="font-medium text-fg-bright mt-1 truncate">{tx.description}</div>
          <div className="text-xs text-fg-dim mt-0.5">{tx.normalizedDescription}</div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Catégorie</label>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {builtins.map((c, idx) => (
                <button
                  key={c}
                  ref={idx === 0 ? firstCategory : undefined}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'px-2.5 py-1.5 rounded text-xs font-medium border transition-colors',
                    category === c
                      ? 'bg-accent/20 border-accent text-accent-bright'
                      : 'bg-surface-2 border-border text-fg-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
              {userCats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.name)}
                  className={cn(
                    'px-2.5 py-1.5 rounded text-xs font-medium border transition-colors',
                    category === c.name
                      ? 'bg-accent/20 border-accent text-accent-bright'
                      : 'bg-surface-2 border-border text-fg-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {!creatingCat ? (
              <button
                onClick={() => setCreatingCat(true)}
                className="mt-2 text-xs text-accent-bright hover:underline"
              >
                + Nouvelle catégorie
              </button>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  className="input text-xs flex-1"
                  placeholder="Nom de la catégorie (ex: Cadeaux)"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  autoFocus
                />
                <button
                  className="btn-primary text-xs"
                  onClick={async () => {
                    if (!newCatName.trim()) return;
                    await addCategory.mutateAsync(newCatName.trim());
                    setCategory(newCatName.trim());
                    setNewCatName('');
                    setCreatingCat(false);
                  }}
                  disabled={addCategory.isPending}
                >
                  Créer
                </button>
                <button onClick={() => { setCreatingCat(false); setNewCatName(''); }} className="btn-ghost text-xs">
                  Annuler
                </button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="picker-subcategory" className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Sous-catégorie (optionnel)</label>
            <input
              id="picker-subcategory"
              aria-describedby={frenchHint(subcategory) ? 'picker-subcategory-hint' : undefined}
              className="input text-sm mt-2 w-full"
              placeholder="ex: salaire, courses, abonnement…"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
            />
            {frenchHint(subcategory) && (
              <div id="picker-subcategory-hint" className="text-xs text-fg-muted mt-1">Affichée : {frenchHint(subcategory)}</div>
            )}
          </div>

          <fieldset className="border-t border-border pt-4 space-y-3">
            <legend className="sr-only">Règle de catégorisation</legend>
            <label className={cn('flex items-start gap-2', key ? 'cursor-pointer' : 'opacity-60')}>
              <input
                type="radio"
                name="picker-rule"
                checked={memorize}
                disabled={!key}
                onChange={() => setRuleMode('memorize')}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="text-fg">{key ? `Mémoriser pour « ${key} »` : 'Mémoriser pour ce marchand'}</div>
                <div className="text-xs text-fg-muted mt-0.5">
                  {key
                    ? 'Crée la règle à partir de ce nom, sans motif à saisir : elle reconnaîtra les libellés qui le contiennent.'
                    : 'Aucun nom de marchand reconnu dans ce libellé.'}
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="picker-rule"
                checked={createRule}
                onChange={() => setRuleMode('pattern')}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="text-fg">Règle avec un motif à saisir</div>
                <div className="text-xs text-fg-muted mt-0.5">
                  Vous écrivez le motif (regex) ; la règle s'auto-applique à chaque nouvel import.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="picker-rule"
                checked={ruleMode === 'none'}
                onChange={() => setRuleMode('none')}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="text-fg">Aucune règle</div>
                <div className="text-xs text-fg-muted mt-0.5">Ne change que cette transaction.</div>
              </div>
            </label>

            {(createRule || memorize) && (
              <>
                {createRule && <div>
                  <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Motif (regex)</label>
                  <input
                    className="input text-xs mt-1.5 w-full font-mono"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                  />
                  <div className="text-[10px] text-fg-dim mt-1">
                    Sensible à la casse désactivée (flag i). Ajusté à la description normalisée par défaut.
                  </div>
                </div>}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replayAll}
                    onChange={(e) => setReplayAll(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <div className="text-fg">Rejouer aussi sur l'historique</div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      Re-catégorise les relevés déjà importés (lent si beaucoup de relevés).
                    </div>
                  </div>
                </label>
              </>
            )}
          </fieldset>
        </div>

        <div className="sticky bottom-0 bg-surface flex justify-end gap-2 mt-6 pt-3 -mb-2">
          <button onClick={onClose} className="btn-ghost text-sm">Annuler</button>
          <button
            onClick={() => patchTx.mutate()}
            disabled={patchTx.isPending || isLoading}
            className="btn-primary text-sm"
          >
            {patchTx.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enregistrer
          </button>
        </div>

        {patchTx.isError && (
          <div className="mt-3 text-xs text-negative">
            {(patchTx.error as Error)?.message ?? 'Erreur'}
          </div>
        )}
      </div>
    </div>
  );
}
