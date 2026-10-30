import { useEffect, useRef, useState } from 'react';
import { Plus, Zap, Check, X as XIcon, Repeat2, EyeOff, RotateCcw, Pencil, Trash2, GitMerge, Loader2 } from 'lucide-react';
import {
  useLoanSuggestions,
  useSnoozeSuggestion,
  useRejectSuggestion,
  useUnsnoozeSuggestion,
  useAcceptSubscriptionSuggestion,
  useSubscriptions,
  useCreateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
  useResetSubscriptions,
} from '@/lib/queries';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DedupeSubscriptionsModal } from '@/components/subscriptions/dedupe-subscriptions-modal';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState, ErrorState } from '@/components/loading-state';
import {
  type LoanSuggestion,
  type Subscription,
  type SubscriptionCategory,
  type SubscriptionInput,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_FREQUENCY_LABELS,
} from '@/types/api';
import { formatEUR, cn, slugify } from '@/lib/utils';
import { SubscriptionForm } from '@/components/subscriptions/subscription-form';

const DEFAULT: SubscriptionInput = {
  name: '',
  creditor: '',
  monthlyAmount: 0,
  frequency: 'monthly',
  category: 'other',
  contractRef: '',
  matchPattern: '',
  isActive: true,
};

export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const create = useCreateSubscription();
  const update = useUpdateSubscription();
  const remove = useDeleteSubscription();
  const suggestions = useLoanSuggestions();
  const snooze = useSnoozeSuggestion();
  const reject = useRejectSuggestion();
  const unsnooze = useUnsnoozeSuggestion();
  const acceptAsSub = useAcceptSubscriptionSuggestion();
  const resetSubs = useResetSubscriptions();

  const [editing, setEditing] = useState<Subscription | null>(null);
  const [creating, setCreating] = useState(false);
  const [prefilled, setPrefilled] = useState<SubscriptionInput | null>(null);
  const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);

  // Message d'échec ou de résultat d'une action hors formulaire, montré dans la page
  // (jamais un alert natif) ; fermable.
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [toDelete, setToDelete] = useState<Subscription | null>(null);
  const [resetAsked, setResetAsked] = useState(false);

  // Plusieurs actions peuvent échouer en se chevauchant : les messages s'ajoutent, aucun n'est perdu.
  const fail = (text: string) =>
    setNotice((prev) => ({ kind: 'error', text: prev?.kind === 'error' ? `${prev.text}\n${text}` : text }));
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Après une confirmation qui retire l'élément d'origine (ligne supprimée), le focus tombait sur
  // <body> : même chose pour « Réafficher » et « Connu, masquer », dont la ligne est retirée par la
  // mise à jour optimiste. `keepFocus` compte les appels en cours (deux qui se chevauchent : la fin
  // du premier ne lève pas la garde du second) ; tant qu'il est > 0, tout rendu qui perd le focus
  // le rend à « Nouvel abonnement ».
  const newButton = useRef<HTMLButtonElement>(null);
  const keepFocus = useRef(0);
  const restoreFocus = () => {
    const a = document.activeElement;
    if (keepFocus.current > 0 && (!a || a === document.body || !a.isConnected)) newButton.current?.focus();
  };
  useEffect(restoreFocus);

  // Lance l'appel en gardant le focus sur un élément présent jusqu'à sa réponse (réussie ou refusée).
  const keepingFocus = (call: Promise<unknown>, failure: (e: unknown) => string) => {
    keepFocus.current += 1;
    return call
      .catch((e) => fail(failure(e)))
      .finally(() => { restoreFocus(); keepFocus.current -= 1; });
  };

  const handleReset = async () => {
    setResetAsked(false);
    setNotice(null);
    try {
      const result = await resetSubs.mutateAsync();
      setNotice({
        kind: 'info',
        text: `${result.deletedSubscriptions} abonnement(s) supprimé(s), ${result.resetSuggestions} suggestion(s) remise(s) à trier.`,
      });
    } catch (e) {
      fail(`Réinitialisation impossible : ${reason(e)}`);
    }
  };

  const handleDelete = (sub: Subscription) => {
    setToDelete(null);
    setNotice(null);
    void keepingFocus(remove.mutateAsync(sub.id), (e) => `Suppression de ${sub.name} impossible : ${reason(e)}`);
  };

  if (subs.isLoading || suggestions.isLoading) return <LoadingState />;
  if (subs.isError && !subs.data) {
    return (
      <>
        <PageHeader eyebrow="Abonnements & factures" title="Abonnements" />
        <ErrorState
          message="Impossible de charger les abonnements."
          onRetry={() => { void subs.refetch(); }}
          retrying={subs.isFetching}
        />
      </>
    );
  }

  const items = subs.data ?? [];
  const suggestionsFailed = suggestions.isError && !suggestions.data;
  const active = items.filter((s) => s.isActive);
  const inactive = items.filter((s) => !s.isActive);
  const totalMonthly = active.reduce((sum, s) => sum + s.monthlyAmount, 0);

  const allSugg = (suggestions.data ?? []).filter(
    (s) => s.suggestedType === 'subscription' || s.suggestedType === 'utility',
  );
  // Une suggestion est "déjà couverte" si un sub actif :
  //   - matche son label via matchPattern regex
  //   - OU partage un mot-clé significatif + montant ±10%
  // Évite de proposer 50 fois "EDF / Orange Fibre" alors qu'ils sont déjà
  // créés. Filtre purement UI : la suggestion reste pending en base, donc
  // si l'user supprime le sub, elle réapparaît.
  const STOP = new Set(['abonnement', 'abonnements', 'facture', 'factures', 'mensuel', 'mensuelle', 'paiement', 'prelevement', 'sas', 'sa', 'sarl', 'france', 'fr', 'des', 'pour', 'par', 'avec']);
  const sigWords = (s: string) => new Set(slugify(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)));
  const isSuggCovered = (sugg: typeof allSugg[number]) => {
    for (const sub of active) {
      // 1. matchPattern regex match
      if (sub.matchPattern) {
        try {
          if (new RegExp(sub.matchPattern, 'i').test(sugg.label)) return true;
        } catch { /* invalid regex, skip */ }
      }
      // 2. creditor identique
      if (sub.creditor && sugg.creditor) {
        if (slugify(sub.creditor) === slugify(sugg.creditor)) return true;
      }
      // 3. slug name partage 1 mot ≥4 lettres + montant ±10%
      const subWords = sigWords(sub.name);
      const suggWords = sigWords(sugg.label);
      const shared = [...subWords].some((w) => suggWords.has(w));
      const amountClose =
        Math.abs(sub.monthlyAmount - sugg.monthlyAmount)
          <= Math.max(sub.monthlyAmount, sugg.monthlyAmount) * 0.1;
      if (shared && amountClose) return true;
    }
    return false;
  };
  const pendingAll = allSugg.filter((s) => s.status === 'pending');
  const coveredCount = pendingAll.filter(isSuggCovered).length;
  const pendingSugg = pendingAll.filter((s) => !isSuggCovered(s));
  const hiddenSugg = allSugg.filter((s) => s.status === 'snoozed');
  const visibleSubs = pendingSugg.filter((s) => s.suggestedType === 'subscription');
  const visibleUtils = pendingSugg.filter((s) => s.suggestedType === 'utility');

  const handleSave = async (input: SubscriptionInput) => {
    setSaveError(undefined);
    try {
      let saved: Subscription;
      if (editing) saved = await update.mutateAsync({ id: editing.id, input });
      else saved = await create.mutateAsync(input);
      if (pendingSuggestionId) {
        try {
          await acceptAsSub.mutateAsync({ id: pendingSuggestionId, subscriptionId: saved.id });
        } catch (e) {
          console.error('Accept suggestion failed', e);
        }
        setPendingSuggestionId(null);
      }
      setEditing(null);
      setCreating(false);
      setPrefilled(null);
    } catch (e) {
      setSaveError(`Enregistrement impossible : ${reason(e)}`);
    }
  };

  const handleSnooze = (sugg: LoanSuggestion) => {
    setNotice(null);
    void keepingFocus(snooze.mutateAsync(sugg.id), (e) => `Masquage de ${sugg.label} impossible : ${reason(e)}`);
  };

  const handleReject = (sugg: LoanSuggestion) => {
    setNotice(null);
    void keepingFocus(reject.mutateAsync(sugg.id), (e) => `Rejet de ${sugg.label} impossible : ${reason(e)}`);
  };

  const handleUnsnooze = (sugg: LoanSuggestion) => {
    setNotice(null);
    void keepingFocus(unsnooze.mutateAsync(sugg.id), (e) => `Réaffichage de ${sugg.label} impossible : ${reason(e)}`);
  };

  const handleAcceptSuggestion = (s: LoanSuggestion) => {
    setEditing(null);
    setCreating(true);
    setPrefilled({
      name: s.creditor ?? s.label,
      creditor: s.creditor ?? '',
      monthlyAmount: s.monthlyAmount,
      frequency: 'monthly',
      category: s.suggestedType === 'utility' ? 'utility' : 'streaming',
      contractRef: '',
      matchPattern: s.matchPattern,
      isActive: true,
      startDate: s.firstSeenDate,
    });
    setPendingSuggestionId(s.id);
  };

  return (
    <>
      <PageHeader
        eyebrow="Abonnements & factures"
        title={`${formatEUR(totalMonthly)} / mois`}
        subtitle={`${active.length} abonnement${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''}${pendingSugg.length > 0 ? ` · ${pendingSugg.length} suggestion${pendingSugg.length > 1 ? 's' : ''} à trier` : ''}`}
        actions={
          <>
            {hiddenSugg.length > 0 && (
              <button
                onClick={() => setShowHidden((s) => !s)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                  showHidden
                    ? 'bg-accent/10 border-accent/30 text-accent-bright'
                    : 'bg-surface-2 border-border text-fg-muted hover:text-fg-bright',
                )}
              >
                <EyeOff className="h-3.5 w-3.5" />
                {showHidden ? 'Masquer' : 'Voir'} les masqués ({hiddenSugg.length})
              </button>
            )}
            <button
              onClick={() => setDedupeOpen(true)}
              className="btn-secondary"
              title="Détecter et fusionner les doublons d'abonnements (invariant 1 retrait/mois max)"
            >
              <GitMerge className="h-4 w-4" /> Doublons
            </button>
            <button
              onClick={() => { if (!resetSubs.isPending) setResetAsked(true); }}
              aria-disabled={resetSubs.isPending}
              className="btn-secondary text-negative-fg hover:bg-negative/10 hover:text-negative-fg border-negative/30 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
              title="Purge tous les abonnements + reset suggestions à pending"
            >
              {resetSubs.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reset…</>
              ) : (
                <><RotateCcw className="h-4 w-4" /> Reset</>
              )}
            </button>
            <button
              ref={newButton}
              onClick={() => { setCreating(true); setEditing(null); setPrefilled(null); }}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" /> Nouvel abonnement
            </button>
          </>
        }
      />

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'sticky top-16 lg:top-2 z-30 mb-6 card p-3 text-sm flex items-start justify-between gap-3 border-l-4',
            notice.kind === 'error' ? 'border-l-negative text-negative-fg' : 'border-l-positive text-fg-bright',
          )}
        >
          <span className="whitespace-pre-line">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fermer le message" className="btn-ghost p-1 shrink-0">
            <XIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {suggestions.isError && !suggestions.data && (
        <div className="mb-6">
          <ErrorState
            title="Suggestions indisponibles"
            message="Les suggestions d'abonnements n'ont pas pu être chargées ; tes abonnements restent affichés."
            onRetry={() => { void suggestions.refetch(); }}
            retrying={suggestions.isFetching}
          />
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Supprimer ${toDelete.name} ?`}
          confirmLabel="Supprimer"
          onConfirm={() => handleDelete(toDelete)}
          onCancel={() => setToDelete(null)}
        >
          <p>{toDelete.isActive ? 'L’abonnement et son historique de prélèvements détectés seront supprimés.' : 'Cet abonnement inactif sera supprimé définitivement, avec son historique de prélèvements détectés.'}</p>
        </ConfirmDialog>
      )}

      {resetAsked && (
        <ConfirmDialog
          title="Réinitialiser les abonnements ?"
          confirmLabel="Réinitialiser"
          onConfirm={() => { void handleReset(); }}
          onCancel={() => setResetAsked(false)}
        >
          <p>Tous les abonnements actuels sont supprimés et les suggestions repassent à trier.</p>
          <p>Tu pourras ensuite ré-accepter les suggestions propres, avec la règle « 1 retrait par mois au maximum ».</p>
        </ConfirmDialog>
      )}

      {dedupeOpen && <DedupeSubscriptionsModal onClose={() => setDedupeOpen(false)} />}

      {items.length === 0 && pendingSugg.length === 0 && !(showHidden && hiddenSugg.length > 0) ? (
        <EmptyState
          title="Aucun abonnement déclaré"
          hint={suggestionsFailed
            ? 'Les suggestions n’ont pas pu être chargées : réessaie avant d’en conclure qu’il n’y a rien à détecter, ou ajoute un abonnement manuellement.'
            : 'Importe un relevé pour que Claude détecte les charges récurrentes, ou ajoute un abonnement manuellement.'}
        />
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Abonnements actifs ({active.length})
              </h2>
              <div className="card divide-y divide-border">
                {active.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    sub={s}
                    onEdit={() => setEditing(s)}
                    onDelete={() => setToDelete(s)}
                  />
                ))}
              </div>
            </section>
          )}

          {inactive.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-fg-dim" />
                Abonnements inactifs ({inactive.length})
              </h2>
              <div className="card divide-y divide-border opacity-70">
                {inactive.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    sub={s}
                    onEdit={() => setEditing(s)}
                    onDelete={() => setToDelete(s)}
                  />
                ))}
              </div>
            </section>
          )}

          {pendingSugg.length > 0 && (
            <>
              <div className="card p-4 border-l-4 border-l-info bg-info/5">
                <div className="text-sm text-fg-bright font-medium mb-1">
                  Suggestions à trier
                  {coveredCount > 0 && (
                    <span className="ml-2 text-xs text-fg-muted font-normal">
                      ({coveredCount} masquée{coveredCount > 1 ? 's' : ''} car déjà couverte{coveredCount > 1 ? 's' : ''} par un abonnement actif)
                    </span>
                  )}
                </div>
                <div className="text-xs text-fg-muted leading-relaxed">
                  <span className="text-accent-bright font-medium">Enregistrer</span> : ouvre le formulaire pré-rempli pour ajouter cette charge à ton registre.
                  <br />
                  <span className="text-positive font-medium">Connu, masquer</span> : tu reconnais cette charge mais tu ne veux pas l'enregistrer (suggestion masquée, peut revenir).
                  <br />
                  <span className="text-negative font-medium">Faux positif</span> : ce n'est pas un abonnement. Claude ne te la re-proposera plus.
                </div>
              </div>

              {visibleSubs.length > 0 && (
                <SuggSection
                  title="Abonnements suggérés"
                  count={visibleSubs.length}
                  icon={Repeat2}
                  items={visibleSubs}
                  onAccept={handleAcceptSuggestion}
                  onSnooze={handleSnooze}
                  onReject={handleReject}
                />
              )}
              {visibleUtils.length > 0 && (
                <SuggSection
                  title="Factures variables suggérées"
                  count={visibleUtils.length}
                  icon={Zap}
                  items={visibleUtils}
                  onAccept={handleAcceptSuggestion}
                  onSnooze={handleSnooze}
                  onReject={handleReject}
                />
              )}
            </>
          )}

          {showHidden && hiddenSugg.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3 flex items-center gap-2">
                <EyeOff className="h-4 w-4" /> Masqués ({hiddenSugg.length})
              </h2>
              <div className="card divide-y divide-border opacity-70">
                {hiddenSugg.map((s) => (
                  <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg-bright truncate">{s.label}</div>
                      <div className="text-xs text-fg-dim tabular">
                        {formatEUR(s.monthlyAmount)}/mois · vu {s.occurrencesSeen} fois · {s.suggestedType === 'subscription' ? 'abonnement' : 'facture'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnsnooze(s)}
                      aria-label={`Réafficher ${s.label}`}
                      title="Remettre cette suggestion dans la liste à trier"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-info/10 hover:bg-info/20 text-info text-xs font-medium border border-info/30"
                    >
                      <RotateCcw className="h-3 w-3" /> Réafficher
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {(creating || editing) && (
        <SubscriptionForm
          isEdit={!!editing}
          init={prefilled ?? (editing ? toSubscriptionInput(editing) : DEFAULT)}
          onSave={handleSave}
          onCancel={() => {
            setSaveError(undefined);
            setCreating(false);
            setEditing(null);
            setPrefilled(null);
            setPendingSuggestionId(null);
          }}
          busy={create.isPending || update.isPending}
          error={saveError}
        />
      )}
    </>
  );
}

function toSubscriptionInput(s: Subscription): SubscriptionInput {
  return {
    name: s.name,
    creditor: s.creditor ?? '',
    monthlyAmount: s.monthlyAmount,
    frequency: s.frequency,
    category: s.category,
    contractRef: s.contractRef ?? '',
    matchPattern: s.matchPattern,
    isActive: s.isActive,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

function SubscriptionRow({
  sub,
  onEdit,
  onDelete,
}: {
  sub: Subscription;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const lastOcc = sub.occurrencesDetected.length > 0
    ? [...sub.occurrencesDetected].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  return (
    <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-fg-bright truncate flex items-center gap-2">
          <CategoryBadge category={sub.category} />
          {sub.name}
        </div>
        <div className="text-xs text-fg-dim tabular">
          {formatEUR(sub.monthlyAmount)}/mois · {SUBSCRIPTION_FREQUENCY_LABELS[sub.frequency]}
          {sub.occurrencesDetected.length > 0 && (
            <> · {sub.occurrencesDetected.length} prélèvement{sub.occurrencesDetected.length > 1 ? 's' : ''}</>
          )}
          {lastOcc && <> · dernier {lastOcc.date}</>}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={onEdit} aria-label={`Modifier ${sub.name}`} className="btn-ghost p-1.5" title="Modifier">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button onClick={onDelete} aria-label={`Supprimer ${sub.name}`} className="btn-ghost p-1.5 text-negative hover:text-negative" title="Supprimer">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: SubscriptionCategory }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-surface-2 text-fg-muted border border-border">
      {SUBSCRIPTION_CATEGORY_LABELS[category]}
    </span>
  );
}

function SuggSection({
  title,
  count,
  icon: Icon,
  items,
  onAccept,
  onSnooze,
  onReject,
}: {
  title: string;
  count: number;
  icon: typeof Zap;
  items: LoanSuggestion[];
  onAccept: (s: LoanSuggestion) => void;
  onSnooze: (s: LoanSuggestion) => void;
  onReject: (s: LoanSuggestion) => void;
}) {
  return (
    <section>
      <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" /> {title} ({count})
      </h2>
      <div className="card divide-y divide-border">
        {items.map((s) => (
          <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg-bright truncate">{s.label}</div>
              <div className="text-xs text-fg-dim tabular">
                {formatEUR(s.monthlyAmount)}/mois · vu {s.occurrencesSeen} fois
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => onAccept(s)}
                aria-label={`Enregistrer ${s.label}`}
                title="Enregistrer comme abonnement"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent-bright text-xs font-medium border border-accent/30"
              >
                <Plus className="h-3 w-3" /> Enregistrer
              </button>
              <button
                onClick={() => onSnooze(s)}
                aria-label={`Connu, masquer ${s.label}`}
                title="Tu reconnais cette charge. Elle disparaît mais peut revenir si Claude la redétecte avec des changements."
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-positive/10 hover:bg-positive/20 text-positive text-xs font-medium border border-positive/30"
              >
                <Check className="h-3 w-3" /> Connu, masquer
              </button>
              <button
                onClick={() => onReject(s)}
                aria-label={`Faux positif ${s.label}`}
                title="Ce n'est pas un abonnement. Claude ne te la re-proposera plus jamais."
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-negative/10 hover:bg-negative/20 text-negative-fg text-xs font-medium border border-negative/30"
              >
                <XIcon className="h-3 w-3" /> Faux positif
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
