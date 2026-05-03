import { Zap, Check, X as XIcon, Repeat2 } from 'lucide-react';
import { useLoanSuggestions, useSnoozeSuggestion, useRejectSuggestion } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import type { LoanSuggestion } from '@/types/api';
import { formatEUR } from '@/lib/utils';

export function SubscriptionsPage() {
  const { data, isLoading } = useLoanSuggestions();
  const snooze = useSnoozeSuggestion();
  const reject = useRejectSuggestion();

  if (isLoading) return <LoadingState />;
  const items = (data ?? []).filter(
    (s) => s.status === 'pending' && (s.suggestedType === 'subscription' || s.suggestedType === 'utility'),
  );
  const subs = items.filter((s) => s.suggestedType === 'subscription');
  const utils = items.filter((s) => s.suggestedType === 'utility');

  const totalMonthly = items.reduce((sum, s) => sum + s.monthlyAmount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Abonnements & factures"
        title={`${formatEUR(totalMonthly)} / mois`}
        subtitle={`${items.length} suggestion${items.length > 1 ? 's' : ''} détectée${items.length > 1 ? 's' : ''} par Claude — à valider ou ignorer.`}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Aucune suggestion d'abonnement à trier"
          hint="Importe un relevé pour que Claude détecte les charges récurrentes."
        />
      ) : (
        <div className="space-y-8">
          {subs.length > 0 && (
            <Section
              title="Abonnements"
              count={subs.length}
              icon={Repeat2}
              items={subs}
              onSnooze={(id) => snooze.mutate(id)}
              onReject={(id) => reject.mutate(id)}
            />
          )}
          {utils.length > 0 && (
            <Section
              title="Factures variables"
              count={utils.length}
              icon={Zap}
              items={utils}
              onSnooze={(id) => snooze.mutate(id)}
              onReject={(id) => reject.mutate(id)}
            />
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  items,
  onSnooze,
  onReject,
}: {
  title: string;
  count: number;
  icon: typeof Zap;
  items: LoanSuggestion[];
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
                onClick={() => onSnooze(s.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-positive/10 hover:bg-positive/20 text-positive text-xs font-medium border border-positive/30"
              >
                <Check className="h-3 w-3" /> OK je connais
              </button>
              <button
                onClick={() => onReject(s.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-negative/10 hover:bg-negative/20 text-negative text-xs font-medium border border-negative/30"
              >
                <XIcon className="h-3 w-3" /> Pas un abonnement
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
