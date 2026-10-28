import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { useHealthThresholds, useUpdateThresholds, useResetThresholds } from '@/lib/queries';
import type { HealthThresholds } from '@/types/api';
import { cn } from '@/lib/utils';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { ErrorState } from '@/components/loading-state';

// Miroir de `HealthThresholds` où chaque champ numérique édité peut être ''
// pendant la saisie (l'utilisateur vide le champ) — on ne coerce JAMAIS '' en
// 0 silencieusement (`Number('') === 0` sinon un seuil vidé casserait le
// diagnostic sans avertissement). `manualMonthlyIncome` reste `number | null`
// (vide = auto), déjà géré par son propre input.
type ThresholdsDraft = {
  resteAVivre: { orangeBelowPctIncome: number | '' };
  tauxEffort: { orangeAbovePct: number | ''; redAbovePct: number | '' };
  plafonds: { greenBelowPct: number | ''; redAbovePct: number | '' };
  tirages: { redAbovePctIncome: number | '' };
  trajectoire: { horizonMonths: number | ''; stableBandPct: number | '' };
  manualMonthlyIncome: number | null;
};

type FieldKey =
  | 'resteAVivre.orangeBelowPctIncome'
  | 'tauxEffort.orangeAbovePct'
  | 'tauxEffort.redAbovePct'
  | 'plafonds.greenBelowPct'
  | 'plafonds.redAbovePct'
  | 'tirages.redAbovePctIncome'
  | 'trajectoire.horizonMonths'
  | 'trajectoire.stableBandPct';

type ValidationResult =
  | { ok: true; data: HealthThresholds }
  | { ok: false; message: string; invalidKeys: Set<FieldKey> };

/**
 * Valide les 8 seuils du form avant envoi : (1) tous doivent être des
 * nombres finis ≥ 0 — un champ vidé ou négatif ne mute JAMAIS le backend
 * silencieusement ; (2) cohérence orange ≤ rouge pour le taux d'effort et
 * vert ≤ rouge pour les plafonds (sinon le bloc correspondant ne pourrait
 * jamais atteindre l'état rouge). Les plafonds n'ont plus de seuil orange
 * dédié (F2) : `greenBelowPct` sert de borne basse pour l'orange.
 */
function validateThresholdsForm(form: ThresholdsDraft): ValidationResult {
  const entries: [FieldKey, number | ''][] = [
    ['resteAVivre.orangeBelowPctIncome', form.resteAVivre.orangeBelowPctIncome],
    ['tauxEffort.orangeAbovePct', form.tauxEffort.orangeAbovePct],
    ['tauxEffort.redAbovePct', form.tauxEffort.redAbovePct],
    ['plafonds.greenBelowPct', form.plafonds.greenBelowPct],
    ['plafonds.redAbovePct', form.plafonds.redAbovePct],
    ['tirages.redAbovePctIncome', form.tirages.redAbovePctIncome],
    ['trajectoire.horizonMonths', form.trajectoire.horizonMonths],
    ['trajectoire.stableBandPct', form.trajectoire.stableBandPct],
  ];

  const invalidKeys = new Set<FieldKey>();
  for (const [key, v] of entries) {
    if (v === '' || !Number.isFinite(v) || v < 0) invalidKeys.add(key);
  }
  if (invalidKeys.size > 0) {
    return { ok: false, message: 'Seuils invalides : tous les champs doivent être des nombres ≥ 0.', invalidKeys };
  }

  const tauxEffort = {
    orangeAbovePct: form.tauxEffort.orangeAbovePct as number,
    redAbovePct: form.tauxEffort.redAbovePct as number,
  };
  const plafonds = {
    greenBelowPct: form.plafonds.greenBelowPct as number,
    redAbovePct: form.plafonds.redAbovePct as number,
  };

  if (tauxEffort.redAbovePct < tauxEffort.orangeAbovePct) {
    return {
      ok: false,
      message: "Le seuil rouge doit être ≥ au seuil orange (taux d'effort).",
      invalidKeys: new Set<FieldKey>(['tauxEffort.orangeAbovePct', 'tauxEffort.redAbovePct']),
    };
  }
  if (plafonds.redAbovePct < plafonds.greenBelowPct) {
    return {
      ok: false,
      message: 'Le seuil rouge doit être ≥ au seuil vert (plafonds).',
      invalidKeys: new Set<FieldKey>(['plafonds.greenBelowPct', 'plafonds.redAbovePct']),
    };
  }

  return {
    ok: true,
    data: {
      resteAVivre: { orangeBelowPctIncome: form.resteAVivre.orangeBelowPctIncome as number },
      tauxEffort,
      plafonds,
      tirages: { redAbovePctIncome: form.tirages.redAbovePctIncome as number },
      trajectoire: {
        horizonMonths: form.trajectoire.horizonMonths as number,
        stableBandPct: form.trajectoire.stableBandPct as number,
      },
      manualMonthlyIncome: form.manualMonthlyIncome,
    },
  };
}

/**
 * Panneau latéral « Ajuster les seuils ». Pas de composant sheet/dialog
 * partagé dans l'app (cf loan-form.tsx / import-statement-modal.tsx pour le
 * pattern overlay le plus proche) — panneau fixe simple en Tailwind, pas de
 * nouvelle dépendance. Le clavier (focus à l'ouverture, Tab bouclé, Échap, focus
 * rendu au bouton d'origine) vient de `useModalDialog`, comme `Dialog`.
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
  const [form, setForm] = useState<ThresholdsDraft | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [invalidKeys, setInvalidKeys] = useState<Set<FieldKey>>(new Set());
  const { dialogRef } = useModalDialog(onClose);

  useEffect(() => {
    if (thresholds.data && !form) setForm(thresholds.data);
  }, [thresholds.data, form]);

  // Un champ fautif prend le focus (le message d'erreur est en bas du tiroir, parfois hors de vue).
  useEffect(() => {
    if (invalidKeys.size > 0) dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidKeys, dialogRef]);

  const patchForm = (patch: Partial<ThresholdsDraft>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
    updateThresholds.reset();
    resetThresholds.reset();
    if (validationError) {
      setValidationError(null);
      setInvalidKeys(new Set());
    }
  };

  const handleSave = () => {
    if (!form) return;
    const result = validateThresholdsForm(form);
    if (!result.ok) {
      setValidationError(result.message);
      setInvalidKeys(result.invalidKeys);
      return;
    }
    setValidationError(null);
    setInvalidKeys(new Set());
    updateThresholds.mutate(result.data);
  };

  const handleReset = async () => {
    setValidationError(null);
    setInvalidKeys(new Set());
    updateThresholds.reset();
    try {
      setForm(await resetThresholds.mutateAsync());
    } catch {
      // L'échec est dit dans le tiroir (resetThresholds.isError), le formulaire reste tel quel.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresholds-drawer-title"
        tabIndex={-1}
        className="card rounded-none border-l border-y-0 border-r-0 w-full max-w-md h-full overflow-y-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3 sticky top-0 bg-surface z-10">
          <h2 id="thresholds-drawer-title" className="font-display font-semibold text-fg-bright">
            Ajuster les seuils
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label="Fermer" title="Fermer">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {!form && thresholds.isError ? (
          <div className="p-5">
            <ErrorState
              message="Impossible de charger les seuils."
              onRetry={() => thresholds.refetch()}
              retrying={thresholds.isFetching}
            />
          </div>
        ) : !form ? (
          <div className="p-5 text-sm text-fg-dim" role="status">Chargement…</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* En tête du formulaire : au téléphone le pied est hors de vue quand le focus saute sur le champ fautif. */}
            <div role="alert">
              {validationError && (
                <div id="thresholds-error" className="card p-3 bg-negative/10 border-l-4 border-l-negative">
                  <p className="text-xs text-negative-fg font-medium">{validationError}</p>
                </div>
              )}
            </div>

            <Section title="Reste à vivre">
              <NumField
                label="Orange en-dessous de (% du revenu)"
                value={form.resteAVivre.orangeBelowPctIncome}
                invalid={invalidKeys.has('resteAVivre.orangeBelowPctIncome')}
                onChange={(v) => patchForm({ resteAVivre: { orangeBelowPctIncome: v } })}
              />
            </Section>

            <Section title="Charge de la dette (taux d'effort)">
              <NumField
                label="Taux d'effort orange au-dessus de (%)"
                value={form.tauxEffort.orangeAbovePct}
                invalid={invalidKeys.has('tauxEffort.orangeAbovePct')}
                onChange={(v) => patchForm({ tauxEffort: { ...form.tauxEffort, orangeAbovePct: v } })}
              />
              <NumField
                label="Taux d'effort rouge au-dessus de (%)"
                value={form.tauxEffort.redAbovePct}
                invalid={invalidKeys.has('tauxEffort.redAbovePct')}
                onChange={(v) => patchForm({ tauxEffort: { ...form.tauxEffort, redAbovePct: v } })}
              />
            </Section>

            <Section title="Plafonds crédits renouvelables">
              <NumField
                label="Vert en-dessous de (%)"
                value={form.plafonds.greenBelowPct}
                invalid={invalidKeys.has('plafonds.greenBelowPct')}
                onChange={(v) => patchForm({ plafonds: { ...form.plafonds, greenBelowPct: v } })}
              />
              <NumField
                label="Rouge au-dessus de (%)"
                value={form.plafonds.redAbovePct}
                invalid={invalidKeys.has('plafonds.redAbovePct')}
                onChange={(v) => patchForm({ plafonds: { ...form.plafonds, redAbovePct: v } })}
              />
            </Section>

            <Section title="Dépendance aux tirages">
              <NumField
                label="Rouge au-dessus de (% du revenu)"
                value={form.tirages.redAbovePctIncome}
                invalid={invalidKeys.has('tirages.redAbovePctIncome')}
                onChange={(v) => patchForm({ tirages: { redAbovePctIncome: v } })}
              />
            </Section>

            <Section title="Trajectoire 6-12 mois">
              <NumField
                label="Horizon (mois)"
                value={form.trajectoire.horizonMonths}
                invalid={invalidKeys.has('trajectoire.horizonMonths')}
                onChange={(v) => patchForm({ trajectoire: { ...form.trajectoire, horizonMonths: v } })}
              />
              <NumField
                label="Bande stable (%)"
                value={form.trajectoire.stableBandPct}
                invalid={invalidKeys.has('trajectoire.stableBandPct')}
                onChange={(v) => patchForm({ trajectoire: { ...form.trajectoire, stableBandPct: v } })}
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
                    patchForm({
                      manualMonthlyIncome: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </Section>

            {/* Zones annonçantes posées d'avance : un rôle ajouté avec son texte n'est pas annoncé de façon fiable. */}
            <div role="status">
              {updateThresholds.isSuccess && <p className="text-xs text-positive">Seuils enregistrés.</p>}
            </div>
            <div role="alert" className="space-y-2">
              {updateThresholds.isError && <p className="text-xs text-negative-fg">Échec de l'enregistrement.</p>}
              {resetThresholds.isError && <p className="text-xs text-negative-fg">Échec de la restauration des défauts.</p>}
            </div>

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
  invalid,
}: {
  label: string;
  value: number | '';
  onChange: (v: number | '') => void;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-fg-muted block mb-1">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'thresholds-error' : undefined}
        className={cn('input tabular', invalid && 'border-negative focus:border-negative')}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}
