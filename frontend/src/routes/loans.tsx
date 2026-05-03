import { useState, useMemo } from 'react';
import { Plus, CreditCard, Pencil, Trash2, X, Banknote, RefreshCw, BarChart3, EyeOff, RotateCcw, Split } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan, useResetRevolving, useLoanSuggestions, useAcceptSuggestion, useRejectSuggestion, useSnoozeSuggestion, useUnsnoozeSuggestion, useResyncLoan, useSplitLoanByAmount } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { type Loan, type LoanInput, type LoanType, type LoanCategory, LOAN_CATEGORY_LABELS, type LoanSuggestion } from '@/types/api';
import { formatEUR, cn, chartTooltipProps, formatMonthShort } from '@/lib/utils';

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
  const closed = items.filter((l) => !l.isActive);
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

      {items.length > 0 && <LoansMonthlyChart loans={items} />}

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

          {closed.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-negative mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-negative" />
                Crédits terminés ({closed.length})
              </h2>
              <p className="text-xs text-fg-dim mb-3">Ces crédits n'ont plus eu de mensualité dans les 2 derniers relevés. Ils ne sont plus comptés dans la charge mensuelle.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {closed.map((l) => (
                  <ClosedCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer définitivement ${l.name} ?`) && remove.mutate(l.id)} />
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

function detectAmountGroups(loan: Loan): number {
  if (loan.occurrencesDetected.length < 2) return 1;
  const extractRef = (d: string | undefined) => (d?.match(/\d{8,}/)?.[0]) ?? '';
  const set = new Set(
    loan.occurrencesDetected.map((o) => `${Math.round(Math.abs(o.amount))}|${extractRef(o.description)}`),
  );
  return set.size;
}

function SplitButton({ loan }: { loan: Loan }) {
  const split = useSplitLoanByAmount();
  const groupCount = detectAmountGroups(loan);
  if (groupCount < 2) return null;
  const handleClick = async () => {
    if (!confirm(`Découper ce crédit en ${groupCount} sous-crédits selon les montants distincts détectés ?`)) return;
    try {
      const r = await split.mutateAsync(loan.id);
      alert(r.split ? `${r.createdCount} sous-crédit(s) créé(s)` : 'Aucun découpage nécessaire (un seul groupe)');
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };
  return (
    <button
      onClick={handleClick}
      title={`${groupCount} montants distincts détectés`}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-warning/10 hover:bg-warning/20 text-warning text-xs font-medium border border-warning/30 mt-2"
    >
      <Split className="h-3 w-3" /> Découper en {groupCount} sous-crédits
    </button>
  );
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
      <SplitButton loan={loan} />
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
      <SplitButton loan={loan} />
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

function ClosedCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const lastOcc = [...loan.occurrencesDetected].sort((a, b) => b.date.localeCompare(a.date))[0];
  const totalRepaid = loan.occurrencesDetected.reduce((s, o) => s + Math.abs(o.amount), 0);
  return (
    <div className="card p-5 border-l-4 border-l-negative opacity-80">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-negative shrink-0 mt-1.5" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            {loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}
            <div className="text-xs text-fg-dim">Terminé · {LOAN_CATEGORY_LABELS[loan.category]}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="text-xs text-fg-muted tabular space-y-0.5">
        <div>{loan.occurrencesDetected.length} mensualité{loan.occurrencesDetected.length > 1 ? 's' : ''} prélevée{loan.occurrencesDetected.length > 1 ? 's' : ''}</div>
        <div>Total remboursé estimé : <span className="text-fg-bright">{formatEUR(totalRepaid)}</span></div>
        {lastOcc && <div>Dernière mensualité : {lastOcc.date}</div>}
      </div>
      <SplitButton loan={loan} />
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

// Palette de 12 couleurs distinctes pour empilage
const LOAN_COLORS = [
  'hsl(160 84% 50%)', 'hsl(217 91% 60%)', 'hsl(45 93% 50%)', 'hsl(280 85% 65%)',
  'hsl(0 84% 60%)', 'hsl(330 85% 60%)', 'hsl(195 83% 50%)', 'hsl(38 92% 55%)',
  'hsl(120 70% 50%)', 'hsl(260 80% 65%)', 'hsl(20 90% 55%)', 'hsl(180 70% 45%)',
];

function LoansMonthlyChart({ loans }: { loans: Loan[] }) {
  const data = useMemo(() => {
    // Build the last 12 calendar months in YYYY-MM
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    // For each month, sum each loan's occurrences (absolute amount)
    return months.map((monthKey) => {
      const row: Record<string, number | string> = { month: monthKey };
      for (const loan of loans) {
        const totalAbs = loan.occurrencesDetected
          .filter((o) => o.date.slice(0, 7) === monthKey)
          .reduce((sum, o) => sum + Math.abs(o.amount), 0);
        if (totalAbs > 0) row[loan.id] = Math.round(totalAbs * 100) / 100;
      }
      return row;
    });
  }, [loans]);

  // Loans that have at least one occurrence on the visible window
  const visibleLoans = useMemo(() => {
    return loans.filter((l) => data.some((row) => (row[l.id] as number | undefined) ?? 0 > 0));
  }, [loans, data]);

  if (visibleLoans.length === 0) {
    return (
      <section className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-fg-dim" />
          <div className="stat-label">Charge crédits par mois (12 mois glissants)</div>
        </div>
        <div className="text-xs text-fg-dim italic py-8 text-center">
          Aucune mensualité détectée dans tes relevés. Importe un relevé ou re-scanne tes crédits pour peupler le graphique.
        </div>
      </section>
    );
  }

  return (
    <section className="card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-fg-dim" />
        <div className="stat-label">Charge crédits par mois (12 mois glissants)</div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
            <XAxis
              dataKey="month"
              tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }}
              tickFormatter={(m: string) => {
                const [y, mm] = m.split('-');
                return formatMonthShort(Number(mm), Number(y));
              }}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }}
              tickFormatter={(v) => `${v}€`}
            />
            <Tooltip
              {...chartTooltipProps}
              labelFormatter={(m: string) => {
                const [y, mm] = m.split('-');
                return formatMonthShort(Number(mm), Number(y));
              }}
              formatter={(v: number, name: string) => {
                const loan = visibleLoans.find((l) => l.id === name);
                return [formatEUR(v), loan?.creditor ?? loan?.name ?? name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) => {
                const loan = visibleLoans.find((l) => l.id === value);
                return <span className="text-fg-muted">{loan?.creditor ?? loan?.name ?? value}</span>;
              }}
            />
            {visibleLoans.map((loan, i) => (
              <Bar
                key={loan.id}
                dataKey={loan.id}
                stackId="loans"
                fill={LOAN_COLORS[i % LOAN_COLORS.length]}
                radius={i === visibleLoans.length - 1 ? [3, 3, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
