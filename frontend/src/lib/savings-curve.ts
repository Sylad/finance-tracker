import type { BalanceHistoryEntry } from '@/types/api';

export interface SavingsCurve {
  points: BalanceHistoryEntry[];
  startMonth: string;
  endMonth: string;
  startBalance: number;
  endBalance: number;
}

/**
 * Courbe d'une carte Épargne : l'historique des 12 derniers mois, amputé des
 * mois antérieurs à l'ouverture du compte (le plus ancien de la date du solde
 * initial et du premier mouvement), où le solde calculé vaut 0 sans que le
 * compte existe. Moins de deux mois restants : pas de courbe.
 */
export function savingsCurve(
  hist: BalanceHistoryEntry[],
  account: { initialBalanceDate: string; movements: { date: string }[] },
): SavingsCurve | null {
  const dates = [account.initialBalanceDate, ...account.movements.map((m) => m.date)].filter(Boolean);
  const opening = dates.reduce((a, b) => (b < a ? b : a)).slice(0, 7);
  const points = hist.filter((p) => p.month >= opening);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    startMonth: first.month,
    endMonth: last.month,
    startBalance: first.balance,
    endBalance: last.balance,
  };
}
