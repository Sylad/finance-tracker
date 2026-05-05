import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatEUR(amount: number, signed = false): string {
  const sign = signed && amount > 0 ? '+' : '';
  return sign + new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Returns the YYYY-MM id of the month preceding the given one. */
export function prevMonthId(id: string): string | null {
  const m = id.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month < 1) { month = 12; year -= 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatMonth(month: number, year: number): string {
  const names = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${names[month - 1]} ${year}`;
}

export function formatMonthShort(month: number, year: number): string {
  const names = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
    'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${names[month - 1]} ${String(year).slice(2)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit',
  });
}

export function maskAccountNumber(n: string | null | undefined): string {
  if (!n) return '';
  const clean = n.replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  return '••••' + clean.slice(-4);
}

// Recharts <Tooltip /> props partagées pour respecter le thème (texte clair sur fond sombre).
// À utiliser comme `<Tooltip {...chartTooltipProps} />` ou `<Tooltip {...chartTooltipProps} formatter={...} />`.
export const chartTooltipProps = {
  contentStyle: {
    background: 'hsl(var(--surface-2))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 6,
    fontSize: 12,
    color: 'hsl(var(--fg))',
  },
  labelStyle: { color: 'hsl(var(--fg))' },
  itemStyle: { color: 'hsl(var(--fg))' },
};
