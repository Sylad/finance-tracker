import { useState } from 'react';
import { X } from 'lucide-react';
import { type LoanInput, type LoanType, type LoanCategory, LOAN_CATEGORY_LABELS } from '@/types/api';

const CATEGORIES: LoanCategory[] = ['mortgage', 'consumer', 'auto', 'student', 'other'];

export function LoanForm({ init, onSave, onCancel, busy }: { init: LoanInput; onSave: (i: LoanInput) => void; onCancel: () => void; busy: boolean }) {
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
            <Field label="N° de contrat (prioritaire)">
              <input className="input font-mono text-xs" placeholder="ex: 51215116521100" value={form.contractRef ?? ''}
                     onChange={(e) => setForm({ ...form, contractRef: e.target.value })} />
            </Field>
          </div>
          <Field label="Pattern (regex, fallback si pas de n° de contrat)">
            <input className="input font-mono text-xs" placeholder="PRELEVT.*BANQUE" value={form.matchPattern}
                   onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
          </Field>
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
