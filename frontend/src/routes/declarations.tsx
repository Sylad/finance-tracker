import { useState } from 'react';
import { Plus, Trash2, X, Pencil } from 'lucide-react';
import {
  useDeclarations,
  useCreateDeclaration,
  useDeleteDeclaration,
  useUpdateDeclaration,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import {
  DECLARATION_TYPE_LABELS,
  PERIODICITY_LABELS,
  type Declaration,
  type DeclarationInput,
  type DeclarationPeriodicity,
  type DeclarationType,
} from '@/types/api';
import { formatEUR, formatDate, cn } from '@/lib/utils';

const TYPES: DeclarationType[] = ['income', 'loan', 'subscription', 'expense'];
const PERIODICITIES: DeclarationPeriodicity[] = ['monthly', 'quarterly', 'yearly', 'one-shot'];

const TYPE_TONE: Record<DeclarationType, string> = {
  income: 'badge-positive',
  loan: 'badge-warning',
  subscription: 'badge-info',
  expense: 'badge-negative',
};

const empty: DeclarationInput = {
  type: 'expense',
  label: '',
  amount: 0,
  periodicity: 'monthly',
  startDate: null,
  endDate: null,
  category: '',
  notes: '',
  matchPattern: '',
};

export function DeclarationsPage() {
  const { data, isLoading } = useDeclarations();
  const create = useCreateDeclaration();
  const update = useUpdateDeclaration();
  const remove = useDeleteDeclaration();

  const [editing, setEditing] = useState<Declaration | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSave = async (input: DeclarationInput) => {
    if (editing) {
      await update.mutateAsync({ id: editing.id, input });
      setEditing(null);
    } else {
      await create.mutateAsync(input);
      setCreating(false);
    }
  };

  if (isLoading) return <LoadingState />;
  const items = data ?? [];

  return (
    <>
      <PageHeader
        title="Déclarations"
        subtitle="Tes engagements récurrents (revenus, crédits, abonnements). Servent à générer les prévisions et à matcher les transactions automatiquement."
        actions={
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouvelle déclaration
          </button>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="Aucune déclaration pour l'instant." hint="Ajoute tes revenus mensuels, crédits, abonnements." />
      ) : (
        <div className="card divide-y divide-border">
          {items.map((d) => (
            <div key={d.id} className="px-5 py-4 flex items-center gap-4">
              <span className={cn(TYPE_TONE[d.type], 'shrink-0')}>
                {DECLARATION_TYPE_LABELS[d.type]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg-bright truncate">{d.label}</div>
                <div className="text-xs text-fg-dim mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{PERIODICITY_LABELS[d.periodicity]}</span>
                  {d.category && <><span>·</span><span>{d.category}</span></>}
                  {d.startDate && <><span>·</span><span>Depuis {formatDate(d.startDate)}</span></>}
                  {d.endDate && <><span>·</span><span>Jusqu'à {formatDate(d.endDate)}</span></>}
                </div>
              </div>
              <div className={cn('text-right tabular font-medium', d.type === 'income' ? 'text-positive' : 'text-fg-bright')}>
                {formatEUR(d.amount)}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditing(d); setCreating(false); }}
                  className="btn-ghost p-1.5"
                  aria-label="Éditer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => confirm('Supprimer ?') && remove.mutate(d.id)}
                  className="btn-ghost p-1.5 hover:text-negative"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <DeclarationForm
          init={editing ? toInput(editing) : empty}
          onSave={handleSave}
          onCancel={() => { setCreating(false); setEditing(null); }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}

function toInput(d: Declaration): DeclarationInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = d;
  void _id; void _c; void _u;
  return rest;
}

function DeclarationForm({
  init,
  onSave,
  onCancel,
  busy,
}: {
  init: DeclarationInput;
  onSave: (input: DeclarationInput) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<DeclarationInput>(init);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">
            {init.label ? 'Modifier la déclaration' : 'Nouvelle déclaration'}
          </h2>
          <button onClick={onCancel} className="btn-ghost p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="p-5 space-y-3"
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
        >
          <Field label="Libellé">
            <input className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as DeclarationType })}>
                {TYPES.map((t) => <option key={t} value={t}>{DECLARATION_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Périodicité">
              <select className="input" value={form.periodicity} onChange={(e) => setForm({ ...form, periodicity: e.target.value as DeclarationPeriodicity })}>
                {PERIODICITIES.map((p) => <option key={p} value={p}>{PERIODICITY_LABELS[p]}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant (€)">
              <input
                className="input tabular"
                type="number"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Catégorie">
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              <input className="input" type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || null })} />
            </Field>
            <Field label="Fin (optionnel)">
              <input className="input" type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || null })} />
            </Field>
          </div>
          <Field label="Pattern (regex pour matcher la transaction)">
            <input className="input font-mono text-xs" placeholder="LOYER|EDF|SFR" value={form.matchPattern} onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="input min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={busy} className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="stat-label block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
