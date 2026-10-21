import { formatEUR } from '@/lib/utils';

interface ForecastMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
}

/** Points du graphe : montants exacts (centimes gardés), sorties en négatif pour l'empilement. */
export function forecastChartData(months: ForecastMonth[]) {
  return months.map((m) => ({
    label: m.month.slice(2),
    income: m.income,
    expense: -m.expense,
    net: m.net,
  }));
}

/** Info-bulle : le solde garde son signe, revenus et dépenses s'affichent en valeur absolue. */
export function forecastTooltipFormatter(v: number, name: string): [string, string] {
  return [formatEUR(name === 'Solde' ? v : Math.abs(v)), name];
}
