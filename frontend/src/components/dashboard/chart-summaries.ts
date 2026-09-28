import { formatEUR } from '@/lib/utils';

/**
 * Alternatives textuelles des graphiques du tableau de bord (WCAG 1.1.1,
 * L21/t3) : posées en `aria-label` sur le conteneur `role="img"`.
 */

export interface TrendPoint {
  label: string;
  value: number;
}

const plain = (v: number) => String(v);

export function summarizeTrend(
  title: string,
  points: TrendPoint[],
  fmt: (v: number) => string = plain,
): string {
  if (points.length === 0) return `${title} : pas encore de données.`;
  if (points.length === 1) return `${title} : ${fmt(points[0].value)} (${points[0].label}).`;
  const first = points[0];
  const last = points[points.length - 1];
  let min = first;
  let max = first;
  for (const p of points) {
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
  }
  const at = (p: TrendPoint) => `${fmt(p.value)} (${p.label})`;
  return `${title} sur ${points.length} mois : de ${at(first)} à ${at(last)}, minimum ${at(min)}, maximum ${at(max)}.`;
}

export interface InOutPoint {
  label: string;
  credits: number;
  debits: number;
}

export function summarizeInOut(points: InOutPoint[]): string {
  const credits = points.reduce((s, p) => s + p.credits, 0);
  const debits = points.reduce((s, p) => s + p.debits, 0);
  const deficits = points.filter((p) => p.debits > p.credits);
  let tail = 'Aucun mois où les sorties dépassent les entrées.';
  if (deficits.length > 0) {
    const worst = deficits.reduce((w, p) => (p.credits - p.debits < w.credits - w.debits ? p : w));
    tail = `${deficits.length} mois où les sorties dépassent les entrées, le plus marqué : ${worst.label} (${formatEUR(worst.credits - worst.debits)}).`;
  }
  return `Entrées et sorties sur ${points.length} mois. Entrées : ${formatEUR(credits)} au total. Sorties : ${formatEUR(debits)} au total. ${tail}`;
}
