import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { formatEUR, formatEURCompact, formatMonthShort, chartTooltipProps } from '@/lib/utils';
import { summarizeInOut } from './chart-summaries';

const CREDIT_FILL = 'hsl(var(--positive))';
const DEBIT_FILL = 'hsl(var(--negative))';

function monthLabel(m: string) {
  const [y, mm] = m.split('-');
  return formatMonthShort(Number(mm), Number(y));
}

interface YearlyData {
  monthly: { month: string; credits: number; debits: number }[];
  topCategories: { category: string; total: number }[];
}

export function YearlyCharts({ data }: { data: YearlyData }) {
  return (
    <>
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="stat-label">Entrées / sorties (12 mois glissants)</div>
          <ul className="flex items-center gap-4 text-xs text-fg-muted" aria-hidden="true">
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CREDIT_FILL }} /> Entrées
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DEBIT_FILL }} /> Sorties
            </li>
          </ul>
        </div>
        <div
          className="h-56"
          role="img"
          aria-label={summarizeInOut(data.monthly.map((m) => ({ label: monthLabel(m.month), credits: m.credits, debits: m.debits })))}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly}>
              <XAxis
                dataKey="month"
                tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }}
                tickFormatter={monthLabel}
              />
              <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }} width={64} allowDecimals={false} tickFormatter={formatEURCompact} />
              <Tooltip
                {...chartTooltipProps}
                labelFormatter={monthLabel}
                formatter={(v: number, name: string) => [formatEUR(v), name]}
              />
              <Bar dataKey="credits" name="Entrées" fill={CREDIT_FILL} />
              <Bar dataKey="debits" name="Sorties" fill={DEBIT_FILL} />
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
