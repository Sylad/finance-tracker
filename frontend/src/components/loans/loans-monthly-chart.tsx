import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { Loan } from '@/types/api';
import { formatEUR, chartTooltipProps, formatMonthShort } from '@/lib/utils';
import { LOAN_COLORS } from './utils';

export function LoansMonthlyChart({ loans }: { loans: Loan[] }) {
  const data = useMemo(() => {
    // Build the last 12 calendar months in YYYY-MM
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    // For each month, sum each loan's occurrences (absolute amount)
    return months.map((monthKey) => {
      const row: Record<string, number | string> = { month: monthKey };
      for (const loan of loans) {
        const totalAbs = loan.occurrencesDetected
          .filter((o) => o.date.slice(0, 7) === monthKey)
          .reduce((sum, o) => sum + Math.abs(o.amount), 0);
        if (totalAbs > 0) row[loan.id] = Math.round(totalAbs * 100) / 100;
      }
      return row;
    });
  }, [loans]);

  const visibleLoans = useMemo(() => {
    return loans.filter((l) => data.some((row) => (row[l.id] as number | undefined) ?? 0 > 0));
  }, [loans, data]);

  if (visibleLoans.length === 0) {
    return (
      <section className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-fg-dim" />
          <div className="stat-label">Charge crédits par mois (12 mois glissants)</div>
        </div>
        <div className="text-xs text-fg-dim italic py-8 text-center">
          Aucune mensualité détectée dans tes relevés. Importe un relevé ou re-scanne tes crédits pour peupler le graphique.
        </div>
      </section>
    );
  }

  return (
    <section className="card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-fg-dim" />
        <div className="stat-label">Charge crédits par mois (12 mois glissants)</div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
            <XAxis
              dataKey="month"
              tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }}
              tickFormatter={(m: string) => {
                const [y, mm] = m.split('-');
                return formatMonthShort(Number(mm), Number(y));
              }}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }}
              tickFormatter={(v) => `${v}€`}
            />
            <Tooltip
              {...chartTooltipProps}
              labelFormatter={(m: string) => {
                const [y, mm] = m.split('-');
                return formatMonthShort(Number(mm), Number(y));
              }}
              formatter={(v: number, name: string) => {
                const loan = visibleLoans.find((l) => l.id === name);
                return [formatEUR(v), loan?.creditor ?? loan?.name ?? name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) => {
                const loan = visibleLoans.find((l) => l.id === value);
                return <span className="text-fg-muted">{loan?.creditor ?? loan?.name ?? value}</span>;
              }}
            />
            {visibleLoans.map((loan, i) => (
              <Bar
                key={loan.id}
                dataKey={loan.id}
                stackId="loans"
                fill={LOAN_COLORS[i % LOAN_COLORS.length]}
                radius={i === visibleLoans.length - 1 ? [3, 3, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
