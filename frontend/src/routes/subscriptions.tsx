import { useState } from 'react';
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
import { DedupeSubscriptionsModal } from '@/components/subscriptions/dedupe-subscriptions-modal';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import {
  type LoanSuggestion,
  type Subscription,
  type SubscriptionCategory,
  type SubscriptionInput,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_FREQUENCY_LABELS,
} from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';
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

  const handleReset = async () => {
    if (!confirm(
      'Reset des abonnements ?\n\n'
      + 'Cette action :\n'
      + '  • Supprime TOUS les abonnements actuels\n'
      + '  • Reset les suggestions à pending\n\n'
      + 'Tu pourras ensuite ré-accepter les suggestions propres avec l\'invariant "1 retrait/mois max".\n\n'
      + 'Continuer ?'
    )) return;
    try {
      const result = await resetSubs.mutateAsync();
      alert(`${result.deletedSubscriptions} abonnement(s) supprimé(s), ${result.resetSuggestions} suggestion(s) reset à pending.`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };

  if (subs.isLoading || suggestions.isLoading) return <LoadingState />;

  const items = subs.data ?? [];
  const active = items.filter((s) => s.isActive);
  const inactive = items.filter((s) => !s.isActive);
  const totalMonthly = active.reduce((sum, s) => sum + s.monthlyAmount, 0);

  const allSugg = (suggestions.data ?? []).filter(
    (s) => s.suggestedType === 'subscription' || s.suggestedType === 'utility',
  );
  const pendingSugg = allSugg.filter((s) => s.status === 'pending');
  const hiddenSugg = allSugg.filter((s) => s.status === 'snoozed');
  const visibleSubs = pendingSugg.filter((s) => s.suggestedType === 'subscription');
  const visibleUtils = pendingSugg.filter((s) => s.suggestedType === 'utility');

  const handleSave = async (input: SubscriptionInput) => {
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
      alert(`Erreur lors de l'enregistrement : ${(e as Error).message}`);
    }
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
          <div className="flex gap-2">
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
              onClick={handleReset}
              disabled={resetSubs.isPending}
              className="btn-secondary text-negative hover:bg-negative/10 hover:text-negative border-negative/30"
              title="Purge tous les abonnements + reset suggestions à pending"
            >
              {resetSubs.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reset…</>
              ) : (
                <><RotateCcw className="h-4 w-4" /> Reset</>
              )}
            </button>
            <button
              onClick={() => { setCreating(true); setEditing(null); setPrefilled(null); }}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" /> Nouvel abonnement
            </button>
          </div>
        }
      />

      {dedupeOpen && <DedupeSubscriptionsModal onClose={() => setDedupeOpen(false)} />}

      {items.length === 0 && pendingSugg.length === 0 ? (
        <EmptyState
          title="Aucun abonnement déclaré"
          hint="Importe un relevé pour que Claude détecte les charges récurrentes, ou ajoute un abonnement manuellement."
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
                    onDelete={() => confirm(`Supprimer ${s.name} ?`) && remove.mutate(s.id)}
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
                    onDelete={() => confirm(`Supprimer définitivement ${s.name} ?`) && remove.mutate(s.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {pendingSugg.length > 0 && (
            <>
              <div className="card p-4 border-l-4 border-l-info bg-info/5">
                <div className="text-sm text-fg-bright font-medium mb-1">Suggestions à trier</div>
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
                  onSnooze={(id) => snooze.mutate(id)}
                  onReject={(id) => reject.mutate(id)}
                />
              )}
              {visibleUtils.length > 0 && (
                <SuggSection
                  title="Factures variables suggérées"
                  count={visibleUtils.length}
                  icon={Zap}
                  items={visibleUtils}
                  onAccept={handleAcceptSuggestion}
                  onSnooze={(id) => snooze.mutate(id)}
                  onReject={(id) => reject.mutate(id)}
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
                      onClick={() => unsnooze.mutate(s.id)}
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
          init={prefilled ?? (editing ? toSubscriptionInput(editing) : DEFAULT)}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
            setPrefilled(null);
            setPendingSuggestionId(null);
          }}
          busy={create.isPending || update.isPending}
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
        <button onClick={onEdit} className="btn-ghost p-1.5" title="Modifier">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="btn-ghost p-1.5 text-negative hover:text-negative" title="Supprimer">
          <Trash2 className="h-3.5 w-3.5" />
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
  onSnooze: (id: string) => void;
  onReject: (id: string) => void;
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
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onAccept(s)}
                title="Enregistrer comme abonnement"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent-bright text-xs font-medium border border-accent/30"
              >
                <Plus className="h-3 w-3" /> Enregistrer
              </button>
              <button
                onClick={() => onSnooze(s.id)}
                title="Tu reconnais cette charge. Elle disparaît mais peut revenir si Claude la redétecte avec des changements."
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-positive/10 hover:bg-positive/20 text-positive text-xs font-medium border border-positive/30"
              >
                <Check className="h-3 w-3" /> Connu, masquer
              </button>
              <button
                onClick={() => onReject(s.id)}
                title="Ce n'est pas un abonnement. Claude ne te la re-proposera plus jamais."
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-negative/10 hover:bg-negative/20 text-negative text-xs font-medium border border-negative/30"
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
