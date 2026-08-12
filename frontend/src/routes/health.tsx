import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useHealthDiagnostic, useUpdateThresholds } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, ErrorState } from '@/components/loading-state';
import { formatEUR, cn, chartTooltipProps } from '@/lib/utils';
import type { HealthBlockResult, HealthStatus } from '@/types/api';
import { HEALTH_STATUS_LABELS } from '@/types/api';

const STATUS_BADGE: Record<HealthStatus, string> = {
  green: 'badge-positive',
  orange: 'badge-warning',
  red: 'badge-negative',
};

const VERDICT_BANNER: Record<HealthStatus, string> = {
  green: 'bg-positive/10 border-l-positive',
  orange: 'bg-warning/10 border-l-warning',
  red: 'bg-negative/10 border-l-negative',
};

const VERDICT_SENTENCE: Record<HealthStatus, string> = {
  green: 'Ta situation financière est saine.',
  orange: 'Ta situation financière mérite une vigilance particulière.',
  red: 'Ta situation financière nécessite une action.',
};

// Libellés FR des clés `details` renvoyées par les 4 blocs backend
// (health.service.ts) — union des clés des 4 blocs, réutilisée telle quelle.
const DETAIL_LABELS: Record<string, string> = {
  resteAVivre: 'Reste à vivre',
  income: 'Revenu mensuel',
  mensualitesTotal: 'Mensualités crédits',
  depensesCourantes: 'Dépenses courantes',
  abonnementsMensuels: 'Abonnements',
  pctIncome: '% du revenu',
  tauxEffortPct: "Taux d'effort",
  pireReserveNom: 'Réserve la plus chargée',
  pireReservePct: '% plafond (pire réserve)',
  utilisationGlobalePct: '% plafond (global)',
  tiragesMensuels: 'Tirages mensuels',
  remboursementsMensuels: 'Remboursements mensuels',
  flux: 'Flux net',
  sumUsed: 'Encours actuel',
  sumProjected: 'Encours projeté',
  avgMonthlyBalance: 'Solde mensuel moyen',
  horizonMonths: 'Horizon',
};

function formatDetailValue(key: string, value: number | string | null): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (key === 'horizonMonths') return `${value} mois`;
  if (key.toLowerCase().endsWith('pct')) return `${value} %`;
  return formatEUR(value);
}

function ManualIncomeField() {
  const [value, setValue] = useState('');
  const updateThresholds = useUpdateThresholds();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    updateThresholds.mutate({ manualMonthlyIncome: n });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 mt-3">
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="Revenu mensuel (€)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input text-sm w-48"
      />
      <button type="submit" className="btn-primary text-sm" disabled={updateThresholds.isPending}>
        {updateThresholds.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      {updateThresholds.isSuccess && (
        <span className="text-xs text-positive">Revenu manuel enregistré.</span>
      )}
      {updateThresholds.isError && (
        <span className="text-xs text-negative">Échec de l'enregistrement.</span>
      )}
    </form>
  );
}

function BlockCard({
  title,
  block,
  mainFigure,
  children,
}: {
  title: string;
  block: HealthBlockResult;
  mainFigure: ReactNode;
  children?: ReactNode;
}) {
  const detailEntries = Object.entries(block.details);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="stat-label">{title}</div>
        <span className={cn('badge', STATUS_BADGE[block.status])}>
          {HEALTH_STATUS_LABELS[block.status]}
        </span>
      </div>
      <div className="font-display text-display-md font-semibold tabular text-fg-bright mb-1">
        {mainFigure}
      </div>
      {block.thresholdHit && (
        <p className="text-xs text-fg-muted mb-2">{block.thresholdHit}</p>
      )}
      {children}
      {detailEntries.length > 0 && (
        <details className="mt-3 text-xs text-fg-dim">
          <summary className="cursor-pointer select-none hover:text-fg-muted">Détails</summary>
          <div className="mt-2 space-y-1">
            {detailEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span>{DETAIL_LABELS[k] ?? k}</span>
                <span className="tabular text-fg-muted">{formatDetailValue(k, v)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function HealthPage() {
  const { data, isLoading, isError } = useHealthDiagnostic();

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message="Impossible de charger le diagnostic de santé financière." />;

  const { verdict, causes, blocks, income, reliability } = data;

  if (reliability === 'unavailable') {
    return (
      <>
        <PageHeader title="Santé financière" subtitle="Diagnostic automatique basé sur tes revenus, crédits et abonnements." />
        <div className="card p-5 bg-surface-2 border-l-4 border-l-border-strong">
          <div className="font-display font-semibold text-fg-bright mb-1">
            Diagnostic impossible — configure tes revenus
          </div>
          <p className="text-sm text-fg-muted">
            Aucun revenu récurrent n'a pu être détecté automatiquement.{' '}
            <Link to="/income" className="text-accent hover:underline">
              Voir la page Revenus
            </Link>{' '}
            ou saisis un revenu mensuel manuel ci-dessous.
          </p>
          <ManualIncomeField />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Santé financière"
        subtitle="Diagnostic automatique basé sur tes revenus, crédits et abonnements."
      />

      <div className={cn('card p-5 mb-6 border-l-4', VERDICT_BANNER[verdict])}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={cn('badge', STATUS_BADGE[verdict])}>{HEALTH_STATUS_LABELS[verdict]}</span>
          {reliability === 'reduced' && (
            <span className="badge-neutral">Fiabilité réduite (moins de 3 relevés)</span>
          )}
        </div>
        <p className="text-sm font-medium text-fg-bright mb-2">{VERDICT_SENTENCE[verdict]}</p>
        {causes.length > 0 && (
          <ul className="list-disc list-inside text-sm text-fg-muted space-y-1">
            {causes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      {income.source === 'transition' && (
        <div className="card p-5 mb-6 bg-warning/10 border-l-4 border-l-warning">
          <div className="font-display font-semibold text-fg-bright mb-1">
            Changement de revenu détecté — confirme le montant
          </div>
          <p className="text-sm text-fg-muted">
            Le revenu mensuel détecté a varié récemment ({income.label ?? 'revenu'} :{' '}
            {income.monthly != null ? formatEUR(income.monthly) : '—'}). Confirme ou corrige le montant ci-dessous.
          </p>
          <ManualIncomeField />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BlockCard
          title="Reste à vivre"
          block={blocks.resteAVivre}
          mainFigure={
            typeof blocks.resteAVivre.details.resteAVivre === 'number'
              ? `${formatEUR(blocks.resteAVivre.details.resteAVivre)} / mois`
              : '—'
          }
        />
        <BlockCard
          title="Charge de la dette"
          block={blocks.chargeDette}
          mainFigure={
            typeof blocks.chargeDette.details.tauxEffortPct === 'number'
              ? `${blocks.chargeDette.details.tauxEffortPct} %`
              : '—'
          }
        />
        <BlockCard
          title="Dépendance aux tirages"
          block={blocks.fluxTirages}
          mainFigure={
            typeof blocks.fluxTirages.details.flux === 'number'
              ? `${formatEUR(blocks.fluxTirages.details.flux)} / mois`
              : '—'
          }
        />
        <TrajectoireCard block={blocks.trajectoire} />
      </div>
    </>
  );
}

function TrajectoireCard({ block }: { block: HealthBlockResult }) {
  const sumUsed = typeof block.details.sumUsed === 'number' ? block.details.sumUsed : null;
  const sumProjected = typeof block.details.sumProjected === 'number' ? block.details.sumProjected : null;
  const chartData =
    sumUsed !== null && sumProjected !== null
      ? [
          { label: 'Actuel', value: sumUsed },
          { label: 'Projeté', value: sumProjected },
        ]
      : [];

  return (
    <BlockCard
      title="Trajectoire 6-12 mois"
      block={block}
      mainFigure={sumProjected !== null ? `${formatEUR(sumProjected)} projeté` : '—'}
    >
      {chartData.length > 0 && (
        <div className="h-24 my-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip {...chartTooltipProps} formatter={(v: number) => [formatEUR(v), 'Encours']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(217 91% 60%)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'hsl(217 91% 60%)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </BlockCard>
  );
}
