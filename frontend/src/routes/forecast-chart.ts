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

export type ForecastMonthStatus = 'Passé' | 'En cours' | 'Prévu';

/** État d'un mois « AAAA-MM » par rapport au mois de `now` : l'ordre se lit sur année × 12 + mois. */
export function forecastMonthStatus(month: string, now: Date = new Date()): ForecastMonthStatus {
  const [y, m] = month.split('-').map(Number);
  const diff = y * 12 + m - (now.getFullYear() * 12 + now.getMonth() + 1);
  return diff < 0 ? 'Passé' : diff === 0 ? 'En cours' : 'Prévu';
}

/** Réglage d'animation commun au halo et à la ligne du Solde : sans lui, le halo (immobile) précède la ligne qui se dessine. */
export const SOLDE_LINE_ANIMATION = { isAnimationActive: true, animationDuration: 800, animationEasing: 'ease-out' } as const;
