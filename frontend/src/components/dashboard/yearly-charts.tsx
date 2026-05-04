import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { formatEUR, formatMonthShort, chartTooltipProps } from '@/lib/utils';

interface YearlyData {
  monthly: { month: string; credits: number; debits: number }[];
  topCategories: { category: string; total: number }[];
}

export function YearlyCharts({ data }: { data: YearlyData }) {
  return (
    <>
      <div className="card p-5">
        <div className="stat-label mb-3">Entrées / sorties (12 mois glissants)</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly}>
              <XAxis
                dataKey="month"
                tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }}
                tickFormatter={(m: string) => {
                  const [y, mm] = m.split('-');
                  return formatMonthShort(Number(mm), Number(y));
                }}
              />
              <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip
                {...chartTooltipProps}
                labelFormatter={(m: string) => {
                  const [y, mm] = m.split('-');
                  return formatMonthShort(Number(mm), Number(y));
                }}
                formatter={(v: number, name: string) => [formatEUR(v), name]}
              />
              <Bar dataKey="credits" name="Entrées" fill="hsl(160 84% 50%)" />
              <Bar dataKey="debits" name="Sorties" fill="hsl(0 70% 55%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card p-5">
        <div className="stat-label mb-3">Top 5 postes de dépense (12 mois)</div>
        <div className="space-y-2">
          {data.topCategories.map((c) => (
            <div key={c.category} className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">{CATEGORY_LABELS[c.category as TransactionCategory] ?? c.category}</span>
              <span className="font-display tabular text-fg-bright">{formatEUR(c.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
