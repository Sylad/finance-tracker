import { Repeat } from 'lucide-react';
import { useRecurringCredits } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { formatEUR, formatDate, cn } from '@/lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  salary: 'Salaire',
  rental: 'Loyer perçu',
  pension: 'Pension',
  subsidy: 'Aide / Subvention',
  investment: 'Placement',
  other: 'Autre',
};

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: 'Mensuel',
  bimonthly: 'Bimestriel',
  quarterly: 'Trimestriel',
  irregular: 'Irrégulier',
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'badge-positive',
  medium: 'badge-info',
  low: 'badge-warning',
  none: 'badge-neutral',
};

export function IncomePage() {
  const { data, isLoading } = useRecurringCredits();
  if (isLoading) return <LoadingState />;

  const items = data ?? [];
  const total = items.filter((c) => c.isActive).reduce((sum, c) => sum + c.monthlyAmount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Revenus"
        title={`${formatEUR(total)} / mois`}
        subtitle={`${items.filter((c) => c.isActive).length} revenu${items.length > 1 ? 's' : ''} récurrent${items.length > 1 ? 's' : ''} détecté${items.length > 1 ? 's' : ''}.`}
      />

      {items.length === 0 ? (
        <EmptyState title="Aucun crédit récurrent détecté pour l'instant." hint="Importe au moins 2 relevés pour permettre la détection." />
      ) : (
        <div className="card divide-y divide-border">
          {items.map((c) => (
            <div key={c.id} className={cn('px-5 py-4 flex items-center gap-4', !c.isActive && 'opacity-50')}>
              <Repeat className="h-4 w-4 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg-bright truncate">{c.description}</div>
                <div className="flex items-center gap-2 text-xs text-fg-dim mt-0.5 flex-wrap">
                  <span>{CATEGORY_LABEL[c.category] ?? c.category}</span>
                  <span>·</span>
                  <span>{FREQUENCY_LABEL[c.frequency] ?? c.frequency}</span>
                  <span>·</span>
                  <span>Premier vu : {formatDate(c.firstSeenDate)}</span>
                  {c.contractEndDate && (
                    <>
                      <span>·</span>
                      <span>Fin estimée : {formatDate(c.contractEndDate)}</span>
                      <span className={CONFIDENCE_TONE[c.endDateConfidence] ?? 'badge-neutral'}>
                        {c.endDateConfidence}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right tabular">
                <div className="font-display text-base font-semibold text-positive">
                  {formatEUR(c.monthlyAmount)}
                </div>
                <div className="text-[10px] text-fg-dim uppercase tracking-wider">/ mois</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
