import { useMemo, useState } from 'react';
import { Trophy, Frown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area } from 'recharts';
import { useYearlySummaries, useYearlySummary } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { ScoreBadge } from '@/components/score-ring';
import { formatEUR, formatMonth, formatMonthShort, cn, chartTooltipProps } from '@/lib/utils';

export function YearlyPage() {
  const list = useYearlySummaries();
  const years = useMemo(
    () => (list.data ?? []).map((y) => y.year).sort((a, b) => b - a),
    [list.data],
  );
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? years[0] ?? null;
  const detail = useYearlySummary(activeYear ?? undefined);

  if (list.isLoading) return <LoadingState />;

  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Bilan annuel" subtitle="Aucun bilan disponible." />
        <EmptyState title="Pas encore de bilan" hint="Les bilans sont générés automatiquement à chaque nouvelle année." />
      </>
    );
  }

  const summary = detail.data;

  return (
    <>
      <PageHeader
        title={`Bilan ${activeYear}`}
        subtitle={summary ? `${summary.monthsCovered.length} mois couverts · généré le ${new Date(summary.generatedAt).toLocaleDateString('fr-FR')}` : '...'}
        actions={
          <div className="flex bg-surface-2 rounded p-0.5 text-xs">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={cn(
                  'px-3 py-1.5 rounded transition-colors font-medium tabular',
                  activeYear === y ? 'bg-surface-3 text-fg-bright' : 'text-fg-muted hover:text-fg',
                )}
              >
                {y}
              </button>
            ))}
          </div>
        }
      />

      {!summary ? (
        <LoadingState />
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card p-5">
              <div className="stat-label flex items-center gap-1.5"><ArrowUpRight className="h-3 w-3 text-positive" /> Crédits</div>
              <div className="font-display text-xl font-semibold tabular text-positive mt-2">
                {formatEUR(summary.totalCredits)}
              </div>
              <div className="text-xs text-fg-dim tabular mt-1">
                {formatEUR(summary.averageMonthlyCredits)} / mois
              </div>
            </div>
            <div className="card p-5">
              <div className="stat-label flex items-center gap-1.5"><ArrowDownRight className="h-3 w-3 text-negative" /> Débits</div>
              <div className="font-display text-xl font-semibold tabular text-negative mt-2">
                {formatEUR(summary.totalDebits)}
              </div>
              <div className="text-xs text-fg-dim tabular mt-1">
                {formatEUR(summary.averageMonthlyDebits)} / mois
              </div>
            </div>
            <div className="card p-5">
              <div className="stat-label">Épargne nette</div>
              <div className={cn('font-display text-xl font-semibold tabular mt-2', summary.netSavings >= 0 ? 'text-positive' : 'text-negative')}>
                {formatEUR(summary.netSavings, true)}
              </div>
            </div>
            <div className="card p-5">
              <div className="stat-label">Score moyen</div>
              <div className="font-display text-xl font-semibold tabular text-fg-bright mt-2">
                {summary.averageHealthScore.toFixed(1)}
              </div>
              <div className="mt-1"><ScoreBadge score={summary.averageHealthScore} /></div>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="card p-5">
              <div className="stat-label flex items-center gap-1.5 text-positive">
                <Trophy className="h-3.5 w-3.5" /> Meilleur mois
              </div>
              <div className="font-display text-lg font-semibold text-fg-bright mt-2">
                {formatMonth(summary.bestMonth.month, summary.year)}
              </div>
              <div className="text-fg-muted text-sm mt-1">
                Score : <span className="text-fg-bright tabular font-semibold">{summary.bestMonth.score}</span>
              </div>
            </div>
            <div className="card p-5">
              <div className="stat-label flex items-center gap-1.5 text-negative">
                <Frown className="h-3.5 w-3.5" /> Mois le plus difficile
              </div>
              <div className="font-display text-lg font-semibold text-fg-bright mt-2">
                {formatMonth(summary.worstMonth.month, summary.year)}
              </div>
              <div className="text-fg-muted text-sm mt-1">
                Score : <span className="text-fg-bright tabular font-semibold">{summary.worstMonth.score}</span>
              </div>
            </div>
            <div className="card p-5">
              <div className="stat-label">Crédits récurrents</div>
              <div className="font-display text-2xl font-bold tabular text-fg-bright mt-2">
                {summary.recurringCreditsCount}
              </div>
              <div className="text-xs text-fg-dim mt-1">détectés cette année</div>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="card p-5">
              <div className="stat-label mb-4">Progression du score</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.scoreProgression.map((s) => ({
                    label: formatMonthShort(s.month, summary.year),
                    score: s.score,
                  }))} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="yscore-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip {...chartTooltipProps} />
                    <Area type="monotone" dataKey="score" stroke="hsl(160 84% 50%)" strokeWidth={2} fill="url(#yscore-grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-5">
              <div className="stat-label mb-4">Top catégories de dépense</div>
              <div className="space-y-2">
                {summary.topCategories.slice(0, 8).map((c, i) => {
                  const max = summary.topCategories[0]?.totalAmount ?? 1;
                  const pct = (c.totalAmount / max) * 100;
                  return (
                    <div key={c.category}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-fg-muted font-medium">
                          <span className="tabular text-fg-dim mr-2">#{i + 1}</span>
                          {c.category}
                        </span>
                        <span className="tabular text-fg">{formatEUR(c.totalAmount)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent/70 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="stat-label mb-4">Cash flow mensuel</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.scoreProgression.map((p) => ({
                  label: formatMonthShort(p.month, summary.year),
                  score: p.score,
                }))} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                  <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip {...chartTooltipProps} />
                  <Line type="monotone" dataKey="score" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </>
  );
}
