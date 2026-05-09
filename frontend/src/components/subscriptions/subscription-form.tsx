import { useState } from 'react';
import { X } from 'lucide-react';
import {
  type SubscriptionInput,
  type SubscriptionFrequency,
  type SubscriptionCategory,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_FREQUENCY_LABELS,
} from '@/types/api';

const CATEGORIES: SubscriptionCategory[] = [
  'streaming', 'utility', 'software', 'membership', 'telecom', 'insurance', 'other',
];
const FREQUENCIES: SubscriptionFrequency[] = ['monthly', 'quarterly', 'yearly'];

export function SubscriptionForm({
  init,
  onSave,
  onCancel,
  busy,
}: {
  init: SubscriptionInput;
  onSave: (i: SubscriptionInput) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<SubscriptionInput>(init);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onCancel}
    >
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">
            {init.name ? 'Modifier l\'abonnement' : 'Nouvel abonnement'}
          </h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <Field label="Organisme (Netflix, EDF, ...)">
            <input
              className="input"
              value={form.creditor ?? ''}
              onChange={(e) => setForm({ ...form, creditor: e.target.value || undefined })}
              placeholder="ex: NETFLIX"
            />
          </Field>
          <Field label="Nom">
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Catégorie">
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as SubscriptionCategory })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{SUBSCRIPTION_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Fréquence">
              <select
                className="input"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as SubscriptionFrequency })}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{SUBSCRIPTION_FREQUENCY_LABELS[f]}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant mensualisé (€)">
              <input
                className="input tabular"
                type="number"
                step="0.01"
                required
                value={form.monthlyAmount}
                onChange={(e) => setForm({ ...form, monthlyAmount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Référence contrat (optionnel)">
              <input
                className="input font-mono text-xs"
                placeholder="ex: A1234567"
                value={form.contractRef ?? ''}
                onChange={(e) => setForm({ ...form, contractRef: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Pattern (regex)">
            <input
              className="input font-mono text-xs"
              placeholder="NETFLIX|SPOTIFY"
              value={form.matchPattern}
              onChange={(e) => setForm({ ...form, matchPattern: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date début">
              <input
                className="input"
                type="date"
                value={form.startDate ?? ''}
                onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })}
              />
            </Field>
            <Field label="Date fin">
              <input
                className="input"
                type="date"
                value={form.endDate ?? ''}
                onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            <span>Actif</span>
          </label>
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
