import { useState } from 'react';
import { Plus, Trash2, X, Pencil } from 'lucide-react';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import {
  useDeclarations,
  useCreateDeclaration,
  useDeleteDeclaration,
  useUpdateDeclaration,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState, ErrorState } from '@/components/loading-state';
import {
  DECLARATION_TYPE_LABELS,
  PERIODICITY_LABELS,
  type Declaration,
  type DeclarationInput,
  type DeclarationPeriodicity,
  type DeclarationType,
} from '@/types/api';
import { formatEUR, formatDate, cn } from '@/lib/utils';
import { categoryLabelFr, frenchHint } from '@/lib/category-label';

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

// Message montré à l'utilisateur : celui de l'API, ou une phrase claire si le serveur ne répond pas.
function errorText(err: unknown, fallback: string): string {
  if (err instanceof TypeError) return 'Le serveur est injoignable. Vérifie ta connexion et réessaie.';
  return err instanceof Error && err.message ? err.message : fallback;
}

export function DeclarationsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useDeclarations();
  const create = useCreateDeclaration();
  const update = useUpdateDeclaration();
  const remove = useDeleteDeclaration();

  const [editing, setEditing] = useState<Declaration | null>(null);
  const [creating, setCreating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openForm = (target: Declaration | null) => {
    setSaveError(null);
    setEditing(target);
    setCreating(target === null);
  };
  const closeForm = () => {
    setSaveError(null);
    setCreating(false);
    setEditing(null);
  };

  const handleSave = async (input: DeclarationInput) => {
    setSaveError(null);
    try {
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      closeForm();
    } catch (err) {
      setSaveError(errorText(err, 'Enregistrement impossible.'));
    }
  };

  const handleDelete = (d: Declaration) => {
    if (!confirm('Supprimer ?')) return;
    setDeleteError(null);
    remove.mutate(d.id, {
      onError: (err) =>
        setDeleteError(`« ${d.label} » n'a pas été supprimée : ${errorText(err, 'suppression impossible.')}`),
    });
  };

  if (isLoading) return <LoadingState />;

  if (isError && !data) {
    return (
      <>
        <PageHeader title="Déclarations" />
        <ErrorState
          message="Impossible de charger les déclarations."
          onRetry={() => { void refetch(); }}
          retrying={isFetching}
        />
      </>
    );
  }
  const items = data ?? [];

  return (
    <>
      <PageHeader
        title="Déclarations"
        subtitle="Tes engagements récurrents (revenus, crédits, abonnements). Servent à générer les prévisions et à matcher les transactions automatiquement."
        actions={
          <button onClick={() => openForm(null)} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouvelle déclaration
          </button>
        }
      />

      {deleteError && (
        <div role="alert" className="card border-negative/30 p-3 mb-3 text-sm text-negative">{deleteError}</div>
      )}

      {items.length === 0 ? (
        <EmptyState title="Aucune déclaration pour l'instant." hint="Ajoute tes revenus mensuels, crédits, abonnements." />
      ) : (
        <div className="card divide-y divide-border">
          {items.map((d) => (
            <DeclarationRow
              key={d.id}
              d={d}
              onEdit={() => openForm(d)}
              onDelete={() => handleDelete(d)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <DeclarationForm
          key={editing?.id ?? 'new'}
          init={editing ? toInput(editing) : empty}
          onSave={handleSave}
          onCancel={closeForm}
          busy={create.isPending || update.isPending}
          error={saveError}
        />
      )}
    </>
  );
}

export function DeclarationRow({
  d,
  onEdit,
  onDelete,
}: {
  d: Declaration;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Sous 640 px : grille à deux rangées (badge + libellé entier, puis détails à gauche,
  // montant et actions à droite). Dès sm : une seule ligne, détails sous le libellé.
  return (
    <div
      data-testid="declaration-row"
      className="px-5 py-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 sm:flex sm:gap-4"
    >
      <span className={cn(TYPE_TONE[d.type], 'shrink-0 row-start-1 col-start-1')}>
        {DECLARATION_TYPE_LABELS[d.type]}
      </span>
      <div className="contents sm:block sm:flex-1 sm:min-w-0">
        <div className="row-start-1 col-start-2 col-span-3 text-sm font-medium text-fg-bright break-words min-w-0">{d.label}</div>
        <div
          data-testid="declaration-details"
          className="row-start-2 col-start-1 col-span-2 min-w-0 text-xs text-fg-dim sm:mt-0.5 flex items-center gap-x-2 flex-wrap"
        >
          <span>{PERIODICITY_LABELS[d.periodicity]}</span>
          {d.category && <><span>·</span><span>{categoryLabelFr(d.category)}</span></>}
          {d.startDate && <><span>·</span><span>Depuis {formatDate(d.startDate)}</span></>}
          {d.endDate && <><span>·</span><span>Jusqu'à {formatDate(d.endDate)}</span></>}
        </div>
      </div>
      <div
        data-testid="declaration-amount"
        className={cn('row-start-2 col-start-3 shrink-0 whitespace-nowrap text-right tabular font-medium', d.type === 'income' ? 'text-positive' : 'text-fg-bright')}
      >
        {formatEUR(d.amount)}
      </div>
      <div data-testid="declaration-actions" className="row-start-2 col-start-4 flex items-center gap-1">
        <button onClick={onEdit} className="btn-ghost p-1.5" aria-label="Éditer">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative" aria-label="Supprimer">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function toInput(d: Declaration): DeclarationInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = d;
  void _id; void _c; void _u;
  return rest;
}

export function DeclarationForm({
  init,
  onSave,
  onCancel,
  busy,
  error = null,
}: {
  init: DeclarationInput;
  onSave: (input: DeclarationInput) => void;
  onCancel: () => void;
  busy: boolean;
  error?: string | null;
}) {
  const [form, setForm] = useState<DeclarationInput>(init);
  const { dialogRef, initialFocusRef: labelRef } = useModalDialog(onCancel);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="declaration-dialog-title"
        className="card max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3 sticky top-0 bg-surface z-10">
          <h2 id="declaration-dialog-title" className="font-display font-semibold text-fg-bright">
            {init.label ? 'Modifier la déclaration' : 'Nouvelle déclaration'}
          </h2>
          <button type="button" onClick={onCancel} className="btn-ghost p-1" aria-label="Fermer">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <form
          className="p-5 space-y-3"
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
        >
          <Field label="Libellé">
            <input ref={labelRef} className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
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
            <Field
              label="Catégorie"
              hint={frenchHint(form.category) ? `Affichée : ${frenchHint(form.category)}` : undefined}
              hintId="declaration-category-hint"
            >
              <input
                className="input"
                aria-describedby={frenchHint(form.category) ? 'declaration-category-hint' : undefined}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
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
          {error && (
            <div role="alert" className="text-sm text-negative border border-negative/30 rounded-md px-3 py-2">{error}</div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={busy} className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  hintId,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  hintId?: string;
}) {
  return (
    <div>
      <label className="block">
        <span className="stat-label block mb-1.5">{label}</span>
        {children}
      </label>
      {hint && <span id={hintId} className="block text-xs text-fg-muted mt-1">{hint}</span>}
    </div>
  );
}
