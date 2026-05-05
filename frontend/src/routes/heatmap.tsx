import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { SpendingHeatmap } from '@/components/spending-heatmap';
import type { MonthlyStatement, StatementSummary } from '@/types/api';
import { formatEUR } from '@/lib/utils';

export function HeatmapPage() {
  const { data: summaries, isLoading: summariesLoading } = useQuery<StatementSummary[]>({
    queryKey: ['statements'],
    queryFn: () => api.get<StatementSummary[]>('/statements'),
  });

  // Fetch all statement details in a single aggregated query
  const { data: statements, isLoading: detailsLoading } = useQuery<MonthlyStatement[]>({
    queryKey: ['statements', 'all-details', summaries?.map((s) => s.id).join(',')],
    queryFn: () => Promise.all((summaries ?? []).map((s) => api.get<MonthlyStatement>(`/statements/${s.id}`))),
    enabled: !!summaries && summaries.length > 0,
  });
  const isLoading = summariesLoading || detailsLoading;
  const allReady = !!statements;

  // Aggregate debits by day across all statements
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of statements ?? []) {
      for (const t of s.transactions) {
        if (t.amount < 0) {
          map.set(t.date, (map.get(t.date) ?? 0) + Math.abs(t.amount));
        }
      }
    }
    return map;
  }, [statements]);

  const allYears = useMemo(() => {
    const years = new Set<number>();
    for (const s of statements ?? []) years.add(s.year);
    return Array.from(years).sort((a, b) => b - a);
  }, [statements]);

  const [year, setYear] = useState<number | 'rolling'>('rolling');

  const { from, to } = useMemo(() => {
    if (year === 'rolling') {
      const now = new Date();
      const from = new Date(now);
      from.setFullYear(now.getFullYear() - 1);
      from.setDate(now.getDate() + 1);
      return { from, to: now };
    }
    return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
  }, [year]);

  // Top 5 spending days
  const topDays = useMemo(() => {
    return Array.from(byDay.entries())
      .filter(([d]) => {
        const t = Date.parse(d);
        return t >= from.getTime() && t <= to.getTime();
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [byDay, from, to]);

  if (isLoading) return <LoadingState label="Chargement…" />;
  if (!allReady) return <LoadingState label="Agrégation des relevés…" />;

  return (
    <>
      <PageHeader
        eyebrow="Vue chronologique"
        title="Heatmap des dépenses"
        subtitle="Une case par jour, plus c'est rouge plus tu as dépensé."
        actions={
          <select
            value={year}
            onChange={(e) => setYear(e.target.value === 'rolling' ? 'rolling' : Number(e.target.value))}
            className="input text-sm"
          >
            <option value="rolling">12 derniers mois</option>
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      <section className="card p-5 mb-6">
        <SpendingHeatmap byDay={byDay} from={from} to={to} />
      </section>

      <section className="card p-5">
        <div className="stat-label mb-3 flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5" />
          Top 5 journées les plus dépensières
        </div>
        {topDays.length === 0 ? (
          <p className="text-sm text-fg-dim italic py-2">Aucune dépense sur la période.</p>
        ) : (
          <div className="divide-y divide-border">
            {topDays.map(([date, amount], i) => (
              <div key={date} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-3">
                  <span className="font-display text-lg font-semibold text-fg-dim w-6">{i + 1}.</span>
                  <span className="text-fg">{new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </span>
                <span className="tabular text-negative font-semibold">{formatEUR(amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
