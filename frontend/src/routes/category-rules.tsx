import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, RefreshCw, Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
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

function labelFor(cat: string) {
  if ((BUILTIN as string[]).includes(cat)) return CATEGORY_LABELS[cat as TransactionCategory];
  return cat;
}

export function CategoryRulesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ['category-rules'],
    queryFn: () => api.get<Payload>('/category-rules'),
  });

  const [newCatName, setNewCatName] = useState('');

  const addCategory = useMutation({
    mutationFn: (name: string) => api.post('/category-rules/user-categories', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });
  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/category-rules/user-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/category-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });
  const replayAll = useMutation({
    mutationFn: () => api.post<{ processed: number; updated: number }>('/category-rules/replay-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-rules'] });
      qc.invalidateQueries({ queryKey: ['statement'] });
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });

  if (isLoading) return <LoadingState label="Chargement…" />;
  const rules = data?.rules ?? [];
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
        <div className="mb-4 p-3 rounded-md bg-positive/10 border border-positive/40 text-sm">
          Replay terminé : {replayAll.data.updated} relevé(s) modifié(s) sur {replayAll.data.processed} analysé(s).
        </div>
      )}

      <section className="card p-5 mb-6">
        <div className="stat-label mb-3">Catégories personnelles</div>
        <p className="text-xs text-fg-muted mb-3">
          Ajoute des catégories supplémentaires à utiliser dans le picker (en plus des 11 prédéfinies).
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {userCats.length === 0 && <span className="text-xs text-fg-dim italic">Aucune.</span>}
          {userCats.map((c) => (
            <span key={c.id} className="badge-info text-xs flex items-center gap-1.5 pl-2.5 pr-1.5 py-1">
              {c.name}
              <button
                onClick={() => deleteCategory.mutate(c.id)}
                className="hover:text-negative"
                title="Supprimer"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input text-sm flex-1 max-w-xs"
            placeholder="Nom (ex: Cadeaux, Animaux, Voyages…)"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCatName.trim()) {
                addCategory.mutate(newCatName.trim());
                setNewCatName('');
              }
            }}
          />
          <button
            className="btn-primary text-sm"
            disabled={!newCatName.trim() || addCategory.isPending}
            onClick={() => {
              addCategory.mutate(newCatName.trim());
              setNewCatName('');
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
            {rules.sort((a, b) => b.priority - a.priority).map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-3 items-center px-2 py-2.5 text-sm">
                <code className="col-span-5 font-mono text-xs text-fg-bright bg-surface-2 rounded px-2 py-1 truncate" title={r.pattern}>
                  /{r.pattern}/{r.flags}
                </code>
                <div className="col-span-3 text-fg">
                  {labelFor(r.category)}
                  {r.subcategory && <span className="text-xs text-fg-muted ml-1.5">· {r.subcategory}</span>}
                </div>
                <div className="col-span-2 text-xs text-fg-dim tabular text-right">priorité {r.priority}</div>
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => deleteRule.mutate(r.id)}
                    className="text-fg-muted hover:text-negative"
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
