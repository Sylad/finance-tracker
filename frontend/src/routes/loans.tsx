import { useState } from 'react';
import { Plus, CreditCard, Pencil, Trash2, X, Banknote, RefreshCw } from 'lucide-react';
import { useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan, useResetRevolving, useLoanSuggestions, useAcceptSuggestion, useRejectSuggestion, useSnoozeSuggestion, useResyncLoan } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { type Loan, type LoanInput, type LoanType, type LoanCategory, LOAN_CATEGORY_LABELS, type LoanSuggestion } from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';

const CATEGORIES: LoanCategory[] = ['mortgage', 'consumer', 'auto', 'student', 'other'];

const DEFAULT: LoanInput = {
  name: '',
  type: 'classic',
  category: 'consumer',
  monthlyPayment: 0,
  matchPattern: '',
  isActive: true,
  creditor: '',
  startDate: '',
  endDate: '',
};

export function LoansPage() {
  const { data, isLoading } = useLoans();
  const create = useCreateLoan();
  const update = useUpdateLoan();
  const remove = useDeleteLoan();
  const acceptSugg = useAcceptSuggestion();
  const [editing, setEditing] = useState<Loan | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestionToAccept, setSuggestionToAccept] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState<LoanInput | null>(null);

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const classics = items.filter((l) => l.type === 'classic' && l.isActive);
  const revolvings = items.filter((l) => l.type === 'revolving' && l.isActive);
  const totalMonthly = items.filter((l) => l.isActive).reduce((s, l) => s + l.monthlyPayment, 0);

  const handleSave = async (input: LoanInput) => {
    try {
      let saved: Loan;
      if (editing) saved = await update.mutateAsync({ id: editing.id, input });
      else saved = await create.mutateAsync(input);
      if (suggestionToAccept) {
        try {
          await acceptSugg.mutateAsync({ id: suggestionToAccept, loanId: saved.id });
        } catch (e) {
          console.error('Accept suggestion failed', e);
        }
        setSuggestionToAccept(null);
      }
      setEditing(null);
      setCreating(false);
      setPrefilled(null);
    } catch (e) {
      alert(`Erreur lors de l'enregistrement : ${(e as Error).message}`);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Crédits"
        title={`${formatEUR(totalMonthly)} / mois`}
        subtitle={`${items.filter((l) => l.isActive).length} crédit${items.length > 1 ? 's' : ''} actif${items.length > 1 ? 's' : ''}`}
        actions={
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouveau crédit
          </button>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="Aucun crédit déclaré" hint="Ajoute ton crédit immobilier, conso ou ta carte revolving." />
      ) : (
        <div className="space-y-8 mb-6">
          {classics.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits classiques ({classics.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {classics.map((l) => (
                  <ClassicCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}

          {revolvings.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits revolving ({revolvings.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {revolvings.map((l) => (
                  <RevolvingCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <SuggestionsBanner
        onAccept={(s) => {
          setEditing(null);
          setCreating(true);
          setPrefilled({
            name: s.creditor ?? s.label,
            type: 'classic',
            category: 'consumer',
            monthlyPayment: s.monthlyAmount,
            matchPattern: s.matchPattern,
            isActive: true,
            creditor: s.creditor,
            startDate: s.firstSeenDate,
          });
          setSuggestionToAccept(s.id);
        }}
      />

      {(creating || editing) && (
        <LoanForm
          init={prefilled ?? (editing ? toInput(editing) : DEFAULT)}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
            setPrefilled(null);
            setSuggestionToAccept(null);
          }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}

function toInput(l: Loan): LoanInput {
  const { id: _i, occurrencesDetected: _o, createdAt: _c, updatedAt: _u, ...rest } = l;
  void _i; void _o; void _c; void _u;
  return rest;
}

function ClassicCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const resync = useResyncLoan();
  const start = loan.startDate ? new Date(loan.startDate).getTime() : 0;
  const end = loan.endDate ? new Date(loan.endDate).getTime() : 0;
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
  const monthsRemaining = end > now ? Math.ceil((end - now) / (1000 * 60 * 60 * 24 * 30.44)) : 0;
  const occurrences = loan.occurrencesDetected.length;

  const handleResync = async () => {
    if (!confirm(`Re-scanner tous les relevés pour ${loan.name} ?`)) return;
    try {
      const res = await resync.mutateAsync({ id: loan.id });
      alert(`Re-synchronisé sur ${res.rescanned} relevé(s)`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-accent" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            {loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}
            <div className="text-xs text-fg-dim">{LOAN_CATEGORY_LABELS[loan.category]} · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {loan.startDate && loan.endDate ? (
        <>
          <div className="h-2 bg-surface-3 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-dim">{pct}% écoulé</span>
            <span className="text-fg-bright tabular">{monthsRemaining} mois restants</span>
          </div>
          <div className="mt-2 text-xs text-fg-muted tabular">
            {occurrences} mensualité{occurrences > 1 ? 's' : ''} prélevée{occurrences > 1 ? 's' : ''}
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-dim italic">Renseigne les dates de début et fin pour activer le suivi.</p>
      )}
      <button
        onClick={handleResync}
        disabled={resync.isPending}
        className="btn-ghost text-xs mt-3 flex items-center gap-1"
      >
        <RefreshCw className={`h-3 w-3 ${resync.isPending ? 'animate-spin' : ''}`} />
        {resync.isPending ? 'Re-scan en cours…' : 'Re-scanner les relevés'}
      </button>
    </div>
  );
}

function RevolvingCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const reset = useResetRevolving();
  const resync = useResyncLoan();
  const max = loan.maxAmount ?? 0;
  const used = loan.usedAmount ?? 0;
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  const tone = pct >= 80 ? 'bg-negative' : pct >= 50 ? 'bg-warning' : 'bg-positive';

  const handleReset = async () => {
    const v = prompt(`Solde utilisé actuel pour ${loan.name} (max ${formatEUR(max)}) :`, String(used));
    if (v == null) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return alert('Valeur invalide');
    await reset.mutateAsync({ id: loan.id, usedAmount: n });
  };

  const handleResync = async () => {
    const baseline = prompt(
      `Pour re-scanner ${loan.name}, indique le solde utilisé AVANT les remboursements détectés dans tes relevés (ex : si ton revolving était à 1500€ avant les 3 mensualités importées, mets 1500) :`,
      String(loan.usedAmount ?? 0),
    );
    if (baseline === null) return;
    const n = Number(baseline);
    if (!Number.isFinite(n) || n < 0) return alert('Valeur invalide');
    try {
      const res = await resync.mutateAsync({ id: loan.id, baselineUsedAmount: n });
      alert(`Re-synchronisé sur ${res.rescanned} relevé(s)`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-warning" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            {loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}
            <div className="text-xs text-fg-dim">Revolving · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="h-3 bg-surface-3 rounded-full overflow-hidden mb-2">
        <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs tabular">
        <span className="text-fg-bright">{formatEUR(used)} utilisés</span>
        <span className="text-fg-dim">/ {formatEUR(max)} ({pct}%)</span>
      </div>
      <div className="text-xs text-fg-muted tabular mt-1">{formatEUR(max - used)} disponibles</div>
      <button onClick={handleReset} className="btn-ghost text-xs mt-3">Recaler le solde</button>
      <button
        onClick={handleResync}
        disabled={resync.isPending}
        className="btn-ghost text-xs mt-2 flex items-center gap-1"
      >
        <RefreshCw className={`h-3 w-3 ${resync.isPending ? 'animate-spin' : ''}`} />
        {resync.isPending ? 'Re-scan en cours…' : 'Re-scanner les relevés'}
      </button>
    </div>
  );
}

function LoanForm({ init, onSave, onCancel, busy }: { init: LoanInput; onSave: (i: LoanInput) => void; onCancel: () => void; busy: boolean }) {
  const [form, setForm] = useState<LoanInput>(init);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">{init.name ? 'Modifier le crédit' : 'Nouveau crédit'}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <Field label="Organisme (Cofidis, Sofinco, ...)">
            <input className="input" value={form.creditor ?? ''} onChange={(e) => setForm({ ...form, creditor: e.target.value || undefined })} placeholder="ex: COFIDIS" />
          </Field>
          <Field label="Nom"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LoanType })}>
                <option value="classic">Classique</option>
                <option value="revolving">Revolving</option>
              </select>
            </Field>
            <Field label="Catégorie">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as LoanCategory })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{LOAN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mensualité (€)">
              <input className="input tabular" type="number" step="0.01" required value={form.monthlyPayment}
                     onChange={(e) => setForm({ ...form, monthlyPayment: Number(e.target.value) })} />
            </Field>
            <Field label="Pattern (regex)">
              <input className="input font-mono text-xs" placeholder="PRELEVT.*BANQUE" value={form.matchPattern}
                     onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
            </Field>
          </div>
          {form.type === 'classic' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date début">
                <input className="input" type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })} />
              </Field>
              <Field label="Date fin">
                <input className="input" type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plafond (€)">
                <input className="input tabular" type="number" step="0.01" required value={form.maxAmount ?? 0}
                       onChange={(e) => setForm({ ...form, maxAmount: Number(e.target.value) })} />
              </Field>
              <Field label="Utilisé (€)">
                <input className="input tabular" type="number" step="0.01" value={form.usedAmount ?? 0}
                       onChange={(e) => setForm({ ...form, usedAmount: Number(e.target.value) })} />
              </Field>
            </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="stat-label block mb-1.5">{label}</span>{children}</label>;
}

function SuggestionsBanner({ onAccept }: { onAccept: (s: LoanSuggestion) => void }) {
  const { data } = useLoanSuggestions();
  const reject = useRejectSuggestion();
  const snooze = useSnoozeSuggestion();
  // Cette page concerne les CRÉDITS uniquement.
  // Les suggestions de type subscription/utility appartiennent à la page /subscriptions.
  const items = (data ?? []).filter((s) => s.status === 'pending' && s.suggestedType === 'loan');
  if (items.length === 0) return null;
  return (
    <div className="card p-4 mb-6 border-l-4 border-l-warning">
      <div className="font-display font-semibold text-fg-bright mb-2">
        Suggestions de Claude ({items.length})
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
      </div>
    </div>
  );
}
