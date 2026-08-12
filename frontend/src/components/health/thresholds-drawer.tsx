import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { useHealthThresholds, useUpdateThresholds, useResetThresholds } from '@/lib/queries';
import type { HealthThresholds } from '@/types/api';

/**
 * Panneau latéral « Ajuster les seuils ». Pas de composant sheet/dialog
 * partagé dans l'app (cf loan-form.tsx / import-statement-modal.tsx pour le
 * pattern overlay le plus proche) — panneau fixe simple en Tailwind, pas de
 * nouvelle dépendance.
 *
 * `handleSave` envoie systématiquement les 6 sections COMPLÈTES du form
 * (state initialisé depuis le GET, jamais partiel) : le backend fait un
 * deep-merge par section, donc un champ manquant dans une section modifiée
 * écraserait l'existant côté serveur si on n'envoyait que le champ touché.
 */
export function ThresholdsDrawer({ onClose }: { onClose: () => void }) {
  const thresholds = useHealthThresholds();
  const updateThresholds = useUpdateThresholds();
  const resetThresholds = useResetThresholds();
  const [form, setForm] = useState<HealthThresholds | null>(null);

  useEffect(() => {
    if (thresholds.data && !form) setForm(thresholds.data);
  }, [thresholds.data, form]);

  const handleSave = () => {
    if (!form) return;
    updateThresholds.mutate(form);
  };

  const handleReset = async () => {
    const data = await resetThresholds.mutateAsync();
    setForm(data);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card rounded-none border-l border-y-0 border-r-0 w-full max-w-md h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3 sticky top-0 bg-surface z-10">
          <h2 className="font-display font-semibold text-fg-bright">Ajuster les seuils</h2>
          <button onClick={onClose} className="btn-ghost p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!form ? (
          <div className="p-5 text-sm text-fg-dim">Chargement…</div>
        ) : (
          <div className="p-5 space-y-5">
            <Section title="Reste à vivre">
              <NumField
                label="Orange en-dessous de (% du revenu)"
                value={form.resteAVivre.orangeBelowPctIncome}
                onChange={(v) => setForm({ ...form, resteAVivre: { orangeBelowPctIncome: v } })}
              />
            </Section>

            <Section title="Charge de la dette (taux d'effort)">
              <NumField
                label="Taux d'effort orange au-dessus de (%)"
                value={form.tauxEffort.orangeAbovePct}
                onChange={(v) => setForm({ ...form, tauxEffort: { ...form.tauxEffort, orangeAbovePct: v } })}
              />
              <NumField
                label="Taux d'effort rouge au-dessus de (%)"
                value={form.tauxEffort.redAbovePct}
                onChange={(v) => setForm({ ...form, tauxEffort: { ...form.tauxEffort, redAbovePct: v } })}
              />
            </Section>

            <Section title="Plafonds crédits renouvelables">
              <NumField
                label="Vert en-dessous de (%)"
                value={form.plafonds.greenBelowPct}
                onChange={(v) => setForm({ ...form, plafonds: { ...form.plafonds, greenBelowPct: v } })}
              />
              <NumField
                label="Orange au-dessus de (%)"
                value={form.plafonds.orangeAbovePct}
                onChange={(v) => setForm({ ...form, plafonds: { ...form.plafonds, orangeAbovePct: v } })}
              />
              <NumField
                label="Rouge au-dessus de (%)"
                value={form.plafonds.redAbovePct}
                onChange={(v) => setForm({ ...form, plafonds: { ...form.plafonds, redAbovePct: v } })}
              />
            </Section>

            <Section title="Dépendance aux tirages">
              <NumField
                label="Rouge au-dessus de (% du revenu)"
                value={form.tirages.redAbovePctIncome}
                onChange={(v) => setForm({ ...form, tirages: { redAbovePctIncome: v } })}
              />
            </Section>

            <Section title="Trajectoire 6-12 mois">
              <NumField
                label="Horizon (mois)"
                value={form.trajectoire.horizonMonths}
                onChange={(v) => setForm({ ...form, trajectoire: { ...form.trajectoire, horizonMonths: v } })}
              />
              <NumField
                label="Bande stable (%)"
                value={form.trajectoire.stableBandPct}
                onChange={(v) => setForm({ ...form, trajectoire: { ...form.trajectoire, stableBandPct: v } })}
              />
            </Section>

            <Section title="Revenu">
              <label className="block">
                <span className="text-xs text-fg-muted block mb-1">Revenu mensuel manuel (€, vide = auto)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input tabular"
                  value={form.manualMonthlyIncome ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      manualMonthlyIncome: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </Section>

            {updateThresholds.isSuccess && <p className="text-xs text-positive">Seuils enregistrés.</p>}
            {updateThresholds.isError && <p className="text-xs text-negative">Échec de l'enregistrement.</p>}

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleReset}
                disabled={resetThresholds.isPending}
                className="btn-secondary text-sm"
              >
                {resetThresholds.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Restaurer les défauts
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateThresholds.isPending}
                className="btn-primary text-sm"
              >
                {updateThresholds.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="stat-label mb-2">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-fg-muted block mb-1">{label}</span>
      <input
        type="number"
        step="0.1"
        className="input tabular"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
