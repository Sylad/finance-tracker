import { useEffect, useState, type FormEvent } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Save, Loader2 } from 'lucide-react';
import { useBudget, useDemoStatus, useUpdateBudget } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingState } from '@/components/loading-state';
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, type Budget } from '@/types/api';

// Un plafond est un nombre entier d'euros (9 chiffres au plus) ; vide = pas de plafond.
const AMOUNT = /^\d{1,9}$/;
const AMOUNT_ERROR = 'Entre un montant entier en euros, sans signe ni décimale (ex. 250).';
const LEAVE_MESSAGE = 'Des modifications du budget ne sont pas enregistrées. Quitter la page quand même ?';

export function BudgetPage() {
  const { data, isLoading, isError, isFetching, refetch } = useBudget();
  const demo = useDemoStatus();
  const update = useUpdateBudget();
  // Seuls les champs touchés sont gardés ici : un rafraîchissement ou un retour en arrière
  // optimiste du cache ne doit jamais effacer ce que la personne a saisi.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const base = (cat: string) => String(data?.[cat as keyof Budget] ?? '');
  const valueOf = (cat: string) => edits[cat] ?? base(cat);
  const errors: Record<string, string> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    const v = valueOf(cat).trim();
    // Seul un champ touché est validé : un plafond décimal déjà enregistré reste accepté.
    if (cat in edits && v !== '' && !AMOUNT.test(v)) errors[cat] = AMOUNT_ERROR;
  }
  const dirty = EXPENSE_CATEGORIES.some((cat) => valueOf(cat).trim() !== base(cat));
  const forced = demo.data?.forced === true;

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm(LEAVE_MESSAGE),
    enableBeforeUnload: () => dirty,
  });

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dirty || forced || update.isPending) return;
    if (Object.keys(errors).length > 0) {
      e.currentTarget.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const budget: Budget = { ...data };
    const sent: Record<string, string> = {};
    for (const cat of EXPENSE_CATEGORIES) {
      const v = valueOf(cat).trim();
      sent[cat] = valueOf(cat);
      if (v === '') delete budget[cat];
      else budget[cat] = Number(v);
    }
    setSaveError(null);
    try {
      await update.mutateAsync(budget);
      // Ne retire que ce qui a été envoyé : une saisie faite pendant l'appel est conservée.
      setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([c, v]) => v !== sent[c])));
      setSaved(true);
    } catch (err) {
      setSaved(false);
      setSaveError(
        err instanceof TypeError
          ? 'Le serveur est injoignable. Vérifie ta connexion et réessaie.'
          : err instanceof Error ? err.message : 'Enregistrement impossible.',
      );
    }
  };

  if (isLoading) return <LoadingState />;

  if (isError && !data) {
    return (
      <>
        <PageHeader title="Budget" />
        <ErrorState
          message="Impossible de charger les budgets."
          onRetry={() => { void refetch(); }}
          retrying={isFetching}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Budget"
        subtitle="Définis un plafond mensuel par catégorie. Le tableau de bord affichera la progression à chaque relevé."
      />

      <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
        <div className="card divide-y divide-border">
          {EXPENSE_CATEGORIES.map((cat) => {
            const id = `budget-${cat}`;
            const error = errors[cat];
            return (
              <div key={cat} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor={id} className="text-sm font-medium text-fg-bright flex-1">
                    {CATEGORY_LABELS[cat]}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id={id}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={valueOf(cat)}
                      onChange={(e) => {
                        setSaveError(null);
                        setEdits((d) => ({ ...d, [cat]: e.target.value }));
                      }}
                      placeholder="Aucun"
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-unit ${id}-error` : `${id}-unit`}
                      className="input w-28 text-right tabular"
                    />
                    <span id={`${id}-unit`} className="text-fg-dim text-sm">€</span>
                  </div>
                </div>
                {error && (
                  <p id={`${id}-error`} className="text-xs text-negative mt-2 text-right">{error}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {saveError && (
            <p role="alert" className="text-xs text-negative">{saveError}</p>
          )}
          <span role="status" className="text-xs text-positive">{saved ? 'Enregistré' : ''}</span>
          {dirty && !forced && <span className="text-xs text-fg-muted">Modifications non enregistrées</span>}
          {forced && <span id="budget-demo-note" className="text-xs text-fg-muted">Enregistrement désactivé en démo</span>}
          <button
            type="submit"
            disabled={!dirty || forced || update.isPending}
            aria-busy={update.isPending || undefined}
            aria-describedby={forced ? 'budget-demo-note' : undefined}
            className="btn-primary"
          >
            {update.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Enregistrement…</>
              : <><Save className="h-4 w-4" aria-hidden="true" /> Enregistrer</>}
          </button>
        </div>
      </form>
    </>
  );
}
