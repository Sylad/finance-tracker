import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { formatEUR, chartTooltipProps } from '@/lib/utils';

interface BalancePoint {
  label: string;
  balance: number;
}

export function BalanceTrendChart({
  series,
  currentBalance,
}: {
  series: BalancePoint[];
  currentBalance: number;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="stat-label">Évolution du solde</div>
          <div className="text-fg-bright font-display text-xl font-semibold mt-1 tabular">
            {formatEUR(currentBalance)}
          </div>
        </div>
      </div>
      {series.length > 1 ? (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: number) => [formatEUR(v), 'Solde']}
              />
              <Line type="monotone" dataKey="balance" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ r: 3, fill: 'hsl(217 91% 60%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-fg-dim italic py-12 text-center">Importe au moins 2 relevés pour voir l'évolution.</p>
      )}
    </div>
  );
}
