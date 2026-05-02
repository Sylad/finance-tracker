import { useState } from 'react';
import { Plus, PiggyBank, Pencil, Trash2, X } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  useSavingsAccounts,
  useCreateSavingsAccount,
  useUpdateSavingsAccount,
  useDeleteSavingsAccount,
  useSavingsHistory,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import {
  type SavingsAccount,
  type SavingsAccountInput,
  type SavingsAccountType,
  SAVINGS_TYPE_LABELS,
} from '@/types/api';
import { formatEUR } from '@/lib/utils';

const TYPES: SavingsAccountType[] = ['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other'];

const DEFAULT: SavingsAccountInput = {
  name: '',
  type: 'livret-a',
  initialBalance: 0,
  initialBalanceDate: new Date().toISOString().slice(0, 10),
  matchPattern: '',
  interestRate: 0.015,
  interestAnniversaryMonth: 12,
};

export function SavingsPage() {
  const { data, isLoading } = useSavingsAccounts();
  const create = useCreateSavingsAccount();
  const update = useUpdateSavingsAccount();
  const remove = useDeleteSavingsAccount();
  const [editing, setEditing] = useState<SavingsAccount | null>(null);
  const [creating, setCreating] = useState(false);

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const total = items.reduce((s, a) => s + a.currentBalance, 0);

  const handleSave = async (input: SavingsAccountInput) => {
    if (editing) await update.mutateAsync({ id: editing.id, input });
    else await create.mutateAsync(input);
    setEditing(null);
    setCreating(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Comptes épargne"
        title={formatEUR(total)}
        subtitle={`${items.length} compte${items.length > 1 ? 's' : ''} suivi${items.length > 1 ? 's' : ''}`}
        actions={
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter un compte
          </button>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Aucun compte épargne déclaré" hint="Commence par déclarer ton Livret A ou ton PEL." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((acc) => (
            <SavingsCard
              key={acc.id}
              account={acc}
              onEdit={() => { setEditing(acc); setCreating(false); }}
              onDelete={() => confirm(`Supprimer "${acc.name}" ?`) && remove.mutate(acc.id)}
            />
          ))}
        </div>
      )}
      {(creating || editing) && (
        <SavingsForm
          init={editing ? toInput(editing) : DEFAULT}
          onSave={handleSave}
          onCancel={() => { setCreating(false); setEditing(null); }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}

function toInput(a: SavingsAccount): SavingsAccountInput {
  return {
    name: a.name,
    type: a.type,
    initialBalance: a.initialBalance,
    initialBalanceDate: a.initialBalanceDate,
    matchPattern: a.matchPattern,
    interestRate: a.interestRate,
    interestAnniversaryMonth: a.interestAnniversaryMonth,
  };
}

function SavingsCard({ account, onEdit, onDelete }: { account: SavingsAccount; onEdit: () => void; onDelete: () => void }) {
  const { data: hist } = useSavingsHistory(account.id, 12);
  const lastDelta = account.movements.length >= 2
    ? account.movements[account.movements.length - 1].amount
    : 0;
  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-accent" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{account.name}</div>
            <div className="text-xs text-fg-dim">{SAVINGS_TYPE_LABELS[account.type]} · {(account.interestRate * 100).toFixed(2)}%</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-4 font-display tabular text-3xl font-bold text-fg-bright">{formatEUR(account.currentBalance)}</div>
      {lastDelta !== 0 && (
        <div className={lastDelta > 0 ? 'text-xs text-positive mt-1' : 'text-xs text-negative mt-1'}>
          {lastDelta > 0 ? '↑' : '↓'} {formatEUR(Math.abs(lastDelta))} dernier mouvement
        </div>
      )}
      {hist && hist.length > 1 && (
        <div className="h-12 mt-3 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hist}>
              <defs>
                <linearGradient id={`grad-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="balance" stroke="hsl(160 84% 50%)" strokeWidth={1.5} fill={`url(#grad-${account.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function SavingsForm({ init, onSave, onCancel, busy }: { init: SavingsAccountInput; onSave: (i: SavingsAccountInput) => void; onCancel: () => void; busy: boolean }) {
  const [form, setForm] = useState<SavingsAccountInput>(init);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">{init.name ? 'Modifier le compte' : 'Nouveau compte épargne'}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <Field label="Nom"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SavingsAccountType })}>
                {TYPES.map((t) => <option key={t} value={t}>{SAVINGS_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Taux d'intérêt (%)">
              <input className="input tabular" type="number" step="0.01" required value={form.interestRate * 100}
                     onChange={(e) => setForm({ ...form, interestRate: Number(e.target.value) / 100 })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Solde initial (€)">
              <input className="input tabular" type="number" step="0.01" required value={form.initialBalance}
                     onChange={(e) => setForm({ ...form, initialBalance: Number(e.target.value) })} />
            </Field>
            <Field label="Date du solde">
              <input className="input" type="date" required value={form.initialBalanceDate}
                     onChange={(e) => setForm({ ...form, initialBalanceDate: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mois anniversaire intérêts (1-12)">
              <input className="input tabular" type="number" min={1} max={12} required value={form.interestAnniversaryMonth}
                     onChange={(e) => setForm({ ...form, interestAnniversaryMonth: Number(e.target.value) })} />
            </Field>
            <Field label="Pattern de détection (regex)">
              <input className="input font-mono text-xs" placeholder="VIR.*PEL" value={form.matchPattern}
                     onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
            </Field>
          </div>
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
