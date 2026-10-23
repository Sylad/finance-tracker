import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { Loan } from '@/types/api';
import { formatEUR, formatEURCompact, chartTooltipProps, formatMonthShort } from '@/lib/utils';
import { LOAN_COLORS, chartSeriesNames, monthlyCharge } from './utils';

/**
 * `statementMonths` : mois (YYYY-MM) couverts par un relevé. Un mois hors relevés
 * sans mensualité n'est pas « 0,00 € » (les crédits courent) : le tableau écrit
 * « — » et le signale, comme /yearly. Absent (relevés pas encore chargés) : rien n'est signalé.
 */
export function LoansMonthlyChart({ loans, statementMonths }: { loans: Loan[]; statementMonths?: ReadonlySet<string> }) {
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
        // Mensualités seules : ni les tirages (dette ajoutée) ni les
        // remboursements anticipés (ils écraseraient l'échelle du graphe).
        const totalAbs = monthlyCharge(loan, monthKey);
        if (totalAbs > 0) row[loan.id] = totalAbs;
      }
      return row;
    });
  }, [loans]);

  const visibleLoans = useMemo(() => {
    return loans.filter((l) => data.some((row) => (row[l.id] as number | undefined) ?? 0 > 0));
  }, [loans, data]);

  const isUncovered = (monthKey: string) => !!statementMonths && !statementMonths.has(monthKey);
  const uncoveredCount = data.filter((row) => isUncovered(row.month as string)).length;

  const names = useMemo(() => chartSeriesNames(visibleLoans), [visibleLoans]);
  const seriesName = (id: string) => names.get(id) ?? id;

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
      <div
        className="h-72"
        role="img"
        aria-label={`Charge mensuelle de ${visibleLoans.length} ${visibleLoans.length > 1 ? 'crédits' : 'crédit'} sur les 12 derniers mois : ${visibleLoans.map((l) => seriesName(l.id)).join(', ')}. ${uncoveredCount > 0 ? `${uncoveredCount} mois sans relevé (montant inconnu). ` : ''}Montants détaillés dans le tableau qui suit.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
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
              width={64}
              allowDecimals={false}
              tickFormatter={(v: number) => formatEURCompact(v)}
            />
            <Tooltip
              {...chartTooltipProps}
              labelFormatter={(m: string) => {
                const [y, mm] = m.split('-');
                return formatMonthShort(Number(mm), Number(y));
              }}
              formatter={(v: number, name: string) => [formatEUR(v), seriesName(name)]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) => <span className="text-fg-muted">{seriesName(value)}</span>}
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
      <div className="sr-only">
        <table>
          <caption>Charge crédits par mois (12 mois glissants)</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              {visibleLoans.map((l) => (
                <th key={l.id} scope="col">{seriesName(l.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const [y, mm] = (row.month as string).split('-');
              return (
                <tr key={row.month as string}>
                  <th scope="row">
                    {formatMonthShort(Number(mm), Number(y))}
                    {isUncovered(row.month as string) ? ' (sans relevé)' : ''}
                  </th>
                  {visibleLoans.map((l) => {
                    const amount = (row[l.id] as number | undefined) ?? 0;
                    return (
                      <td key={l.id}>
                        {amount === 0 && isUncovered(row.month as string) ? '—' : formatEUR(amount)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
