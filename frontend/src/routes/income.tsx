import { Repeat } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useRecurringCredits } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState, ErrorState } from '@/components/loading-state';
import { categoryLabelFr } from '@/lib/category-label';
import { formatEUR, formatDate, cn } from '@/lib/utils';
import type { RecurringCredit } from '@/types/api';

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

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Fiabilité élevée',
  medium: 'Fiabilité moyenne',
  low: 'Fiabilité faible',
  none: 'Fiabilité inconnue',
};

// Le séparateur « · » est rattaché à l'élément qui le suit : au retour à la ligne
// il ouvre la ligne suivante au lieu de rester orphelin en fin de ligne.
function MetaItem({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <span>
      {!first && <span aria-hidden="true">· </span>}
      {children}
    </span>
  );
}

function IncomeRow({ c, ended = false }: { c: RecurringCredit; ended?: boolean }) {
  return (
    <div data-testid={ended ? 'income-ended-row' : 'income-active-row'} className="px-5 py-4 flex items-center gap-4">
      <Repeat className="h-4 w-4 text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <div className="text-sm font-medium text-fg-bright break-words min-w-0">{c.description}</div>
          {ended && <span className="badge-neutral shrink-0">Inactif</span>}
        </div>
        <div className="flex items-center gap-x-2 gap-y-1 text-xs text-fg-dim mt-0.5 flex-wrap">
          <MetaItem first>{categoryLabelFr(c.category)}</MetaItem>
          <MetaItem>{FREQUENCY_LABEL[c.frequency] ?? c.frequency}</MetaItem>
          <MetaItem>Premier vu : {formatDate(c.firstSeenDate)}</MetaItem>
          {ended && <MetaItem>Dernier vu : {formatDate(c.lastSeenDate)}</MetaItem>}
          {c.contractEndDate && (
            <>
              <MetaItem>Fin estimée : {formatDate(c.contractEndDate)}</MetaItem>
              <span className={CONFIDENCE_TONE[c.endDateConfidence] ?? 'badge-neutral'}>
                {CONFIDENCE_LABEL[c.endDateConfidence] ?? c.endDateConfidence}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right tabular shrink-0">
        <div className={cn('font-display text-base font-semibold', ended ? 'text-fg-muted' : 'text-positive')}>
          {formatEUR(c.monthlyAmount)}
        </div>
        <div className="text-[10px] text-fg-dim uppercase tracking-wider">/ mois</div>
      </div>
    </div>
  );
}

export function IncomePage() {
  const { data, isLoading, isError, isFetching, refetch } = useRecurringCredits();
  if (isLoading) return <LoadingState />;

  if (isError && !data) {
    return (
      <>
        <PageHeader eyebrow="Revenus" title="Revenus" />
        <ErrorState
          message="Impossible de charger les revenus récurrents."
          onRetry={() => { void refetch(); }}
          retrying={isFetching}
        />
      </>
    );
  }

  const items = data ?? [];
  const active = items.filter((c) => c.isActive).sort((a, b) => b.monthlyAmount - a.monthlyAmount);
  const ended = items.filter((c) => !c.isActive).sort((a, b) => b.lastSeenDate.localeCompare(a.lastSeenDate));
  const total = active.reduce((sum, c) => sum + c.monthlyAmount, 0);

  const activeText = `${active.length} revenu${active.length > 1 ? 's' : ''} récurrent${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''}`;
  const subtitle = ended.length > 0
    ? `${activeText} · ${ended.length} inactif${ended.length > 1 ? 's' : ''}, exclu${ended.length > 1 ? 's' : ''} du total.`
    : `${activeText}.`;

  return (
    <>
      <PageHeader eyebrow="Revenus" title={`${formatEUR(total)} / mois`} subtitle={subtitle} />

      {items.length === 0 ? (
        <EmptyState
          title="Aucun revenu récurrent détecté pour l’instant."
          hint="Importe au moins 2 relevés pour permettre la détection."
          action={<Link to="/upload" className="btn-secondary inline-flex">Importer un relevé</Link>}
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div className="card divide-y divide-border">
              {active.map((c) => <IncomeRow key={c.id} c={c} />)}
            </div>
          )}
          {ended.length > 0 && (
            <section aria-labelledby="income-ended-title" className="card divide-y divide-border">
              <h2 id="income-ended-title" className="px-5 py-3 text-sm font-medium text-fg-muted">Revenus terminés</h2>
              {ended.map((c) => <IncomeRow key={c.id} c={c} ended />)}
            </section>
          )}
        </div>
      )}
    </>
  );
}
