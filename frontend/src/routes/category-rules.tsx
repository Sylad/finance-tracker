import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, RefreshCw, Loader2, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState, ErrorState } from '@/components/loading-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CategoryRuleSuggestionsBanner } from '@/components/category-rule-suggestions-banner';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';

interface Rule {
  id: string;
  pattern: string;
  flags: string;
  category: string;
  subcategory: string;
  priority: number;
  createdAt: string;
}
interface UserCategory { id: string; name: string }
interface Payload {
  rules: Rule[];
  userCategories: UserCategory[];
  availableCategories: string[];
}

const BUILTIN: TransactionCategory[] = [
  'income', 'housing', 'transport', 'food', 'health',
  'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
];

function reason(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'erreur inconnue';
}

function labelFor(cat: string) {
  if ((BUILTIN as string[]).includes(cat)) return CATEGORY_LABELS[cat as TransactionCategory];
  return cat;
}

export function CategoryRulesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useQuery<Payload>({
    queryKey: ['category-rules'],
    queryFn: () => api.get<Payload>('/category-rules'),
  });

  const [newCatName, setNewCatName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);

  const addCategory = useMutation({
    mutationFn: (name: string) => api.post('/category-rules/user-categories', { name }),
    onSuccess: () => {
      setFailure(null);
      setNewCatName('');
      qc.invalidateQueries({ queryKey: ['category-rules'] });
    },
    onError: (e, name) => setFailure(`Ajout de la catégorie ${name} impossible : ${reason(e)}.`),
  });
  const deleteCategory = useMutation({
    mutationFn: (c: UserCategory) => api.delete(`/category-rules/user-categories/${c.id}`),
    onSuccess: () => {
      setFailure(null);
      qc.invalidateQueries({ queryKey: ['category-rules'] });
    },
    onError: (e, c) => setFailure(`Suppression de la catégorie ${c.name} impossible : ${reason(e)}.`),
  });
  const deleteRule = useMutation({
    mutationFn: (r: Rule) => api.delete(`/category-rules/${r.id}`),
    onSuccess: () => {
      setFailure(null);
      qc.invalidateQueries({ queryKey: ['category-rules'] });
    },
    onError: (e, r) => setFailure(`Suppression de /${r.pattern}/${r.flags} impossible : ${reason(e)}.`),
  });
  const replayAll = useMutation({
    mutationFn: () => api.post<{ processed: number; updated: number }>('/category-rules/replay-all'),
    onMutate: () => setFailure(null),
    onError: (e) => setFailure(`Rejeu impossible : ${reason(e)}.`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-rules'] });
      qc.invalidateQueries({ queryKey: ['statement'] });
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });

  if (isLoading) return <LoadingState label="Chargement…" />;
  if (isError && !data) {
    return (
      <>
        <PageHeader eyebrow="Personnalisation" title="Règles de catégorisation" />
        <ErrorState
          message="Impossible de charger les règles de catégorisation."
          onRetry={() => { void refetch(); }}
          retrying={isFetching}
        />
      </>
    );
  }
  const rules = [...(data?.rules ?? [])].sort((a, b) => b.priority - a.priority);
  const userCats = data?.userCategories ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Personnalisation"
        title="Règles de catégorisation"
        subtitle={`${rules.length} règle${rules.length > 1 ? 's' : ''} active${rules.length > 1 ? 's' : ''} · ${userCats.length} catégorie${userCats.length > 1 ? 's' : ''} perso`}
        actions={
          <button
            onClick={() => replayAll.mutate()}
            disabled={replayAll.isPending || rules.length === 0}
            className="btn-primary text-sm"
          >
            {replayAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Rejouer sur tout l'historique
          </button>
        }
      />

      {replayAll.isSuccess && replayAll.data && (
        <div role="status" className="mb-4 p-3 rounded-md bg-positive/10 border border-positive/40 text-sm">
          Replay terminé : {replayAll.data.updated} relevé(s) modifié(s) sur {replayAll.data.processed} analysé(s).
        </div>
      )}

      {failure && (
        <div role="alert" className="mb-4 p-3 rounded-md bg-negative/10 border border-negative/40 text-sm text-negative-fg flex items-start justify-between gap-3">
          <span>{failure}</span>
          <button type="button" onClick={() => setFailure(null)} aria-label="Fermer le message" className="btn-ghost p-1 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <CategoryRuleSuggestionsBanner />

      <section className="card p-5 mb-6">
        <div className="stat-label mb-3">Catégories disponibles</div>
        <p className="text-xs text-fg-muted mb-3">
          Les 11 catégories prédéfinies sont toujours disponibles. Tu peux ajouter des catégories
          personnelles supplémentaires utilisables dans le picker et les règles.
        </p>

        <div className="text-[10px] uppercase tracking-wider text-fg-dim font-semibold mb-2">
          Prédéfinies
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {BUILTIN.map((c) => (
            <span
              key={c}
              className="badge text-xs px-2.5 py-1 bg-surface-2 border border-border text-fg-muted"
              title={`Identifiant interne : ${c}`}
            >
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-fg-dim font-semibold mb-2">
          Personnelles ({userCats.length})
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {userCats.length === 0 && <span className="text-xs text-fg-dim italic">Aucune pour l'instant.</span>}
          {userCats.map((c) => (
            <span key={c.id} className="badge-info text-xs flex items-center gap-1.5 pl-2.5 pr-1.5 py-1">
              {c.name}
              <button
                type="button"
                onClick={() => deleteCategory.mutate(c)}
                className="hover:text-negative"
                aria-label={`Supprimer la catégorie ${c.name}`}
                title="Supprimer"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Nom de la nouvelle catégorie"
            className="input text-sm flex-1 max-w-xs"
            placeholder="Nom (ex: Cadeaux, Animaux, Voyages…)"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCatName.trim()) {
                addCategory.mutate(newCatName.trim());
              }
            }}
          />
          <button
            className="btn-primary text-sm"
            disabled={!newCatName.trim() || addCategory.isPending}
            onClick={() => {
              addCategory.mutate(newCatName.trim());
            }}
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
      </section>

      <section className="card p-5">
        <div className="stat-label mb-3">Règles actives</div>
        <p className="text-xs text-fg-muted mb-3">
          Chaque nouvelle import passe à travers ces règles, qui peuvent forcer une catégorie quand le motif (regex)
          matche la description normalisée d'une transaction. Les règles avec la priorité la plus élevée gagnent.
        </p>
        {rules.length === 0 ? (
          <div className="text-sm text-fg-dim italic py-6 text-center">
            Aucune règle. Crées-en une depuis la page d'un relevé en cliquant sur le badge catégorie d'une transaction.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-sm">
                <code className="basis-full sm:basis-auto sm:flex-1 min-w-0 font-mono text-xs text-fg-bright bg-surface-2 rounded px-2 py-1 break-all" title={r.pattern}>
                  /{r.pattern}/{r.flags}
                </code>
                <div className="text-fg flex-1 sm:flex-none sm:w-40">
                  {labelFor(r.category)}
                  {r.subcategory && <span className="text-xs text-fg-muted ml-1.5">· {r.subcategory}</span>}
                </div>
                <div className="text-xs text-fg-dim tabular sm:w-20 sm:text-right">priorité {r.priority}</div>
                <div className="ml-auto">
                  <button
                    type="button"
                    onClick={() => setRuleToDelete(r)}
                    className="text-fg-muted hover:text-negative p-1"
                    aria-label={`Supprimer la règle /${r.pattern}/${r.flags}`}
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {ruleToDelete && (
        <ConfirmDialog
          title="Supprimer cette règle ?"
          confirmLabel="Supprimer la règle"
          onCancel={() => setRuleToDelete(null)}
          onConfirm={() => {
            deleteRule.mutate(ruleToDelete);
            setRuleToDelete(null);
          }}
        >
          <p>
            <code className="font-mono">/{ruleToDelete.pattern}/{ruleToDelete.flags}</code> → {labelFor(ruleToDelete.category)}.
            Les transactions déjà catégorisées gardent leur catégorie ; les prochains imports n'appliqueront plus cette règle.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
