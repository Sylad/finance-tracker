import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { useForecast } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { formatEUR, cn, chartTooltipProps } from '@/lib/utils';
import { DECLARATION_TYPE_LABELS } from '@/types/api';

const HORIZONS = [3, 6, 12] as const;

export function ForecastPage() {
  const [horizon, setHorizon] = useState<3 | 6 | 12>(12);
  const { data, isLoading } = useForecast(horizon);

  if (isLoading) return <LoadingState />;
  const months = data ?? [];

  if (months.length === 0) {
    return (
      <>
        <PageHeader title="Prévisions" subtitle="Aucune projection. Configure des déclarations pour générer un prévisionnel." />
        <EmptyState title="Pas de déclaration → pas de prévision" hint="Va dans Déclarations pour ajouter tes revenus et engagements." />
      </>
    );
  }

  const chartData = months.map((m) => ({
    label: m.month.slice(2),
    income: Math.round(m.income),
    expense: -Math.round(m.expense),
    net: Math.round(m.net),
  }));

  return (
    <>
      <PageHeader
        title="Prévisions"
        subtitle="Projection mensuelle basée sur tes déclarations actives."
        actions={
          <div className="flex bg-surface-2 rounded p-0.5 text-xs">
            {HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={cn(
                  'px-3 py-1.5 rounded transition-colors font-medium',
                  horizon === h ? 'bg-surface-3 text-fg-bright' : 'text-fg-muted hover:text-fg',
                )}
              >
                {h} mois
              </button>
            ))}
          </div>
        }
      />

      <section className="card p-5 mb-6">
        <div className="stat-label mb-4">Cash flow projeté</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }} stackOffset="sign">
              <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: number, name: string) => [formatEUR(Math.abs(v)), name]}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border-strong))" />
              <Bar dataKey="income" name="Revenus" stackId="cf" fill="hsl(160 84% 50%)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expense" name="Dépenses" stackId="cf" fill="hsl(0 84% 60%)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {months.map((m) => (
          <div key={m.month} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-display text-base font-semibold text-fg-bright">{m.month}</div>
              <span className={cn('badge tabular text-xs', m.net >= 0 ? 'badge-positive' : 'badge-negative')}>
                {formatEUR(m.net, true)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div>
                <div className="stat-label text-[9px]">Entrées</div>
                <div className="tabular text-positive font-semibold">{formatEUR(m.income)}</div>
              </div>
              <div>
                <div className="stat-label text-[9px]">Sorties</div>
                <div className="tabular text-negative font-semibold">{formatEUR(m.expense)}</div>
              </div>
            </div>
            <div className="space-y-1 text-xs max-h-40 overflow-auto pr-1">
              {m.occurrences.map((o, i) => (
                <div key={`${o.declarationId}-${i}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                        o.type === 'income' ? 'bg-positive' :
                        o.type === 'loan' ? 'bg-warning' :
                        o.type === 'subscription' ? 'bg-info' :
                        'bg-negative',
                      )}
                      title={DECLARATION_TYPE_LABELS[o.type]}
                    />
                    <span className={cn('truncate', o.matched ? 'text-fg' : 'text-fg-muted')}>
                      {o.label}
                    </span>
                  </div>
                  <span className={cn('tabular shrink-0', o.amountSigned >= 0 ? 'text-positive' : 'text-fg-muted')}>
                    {formatEUR(o.amountSigned, true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
