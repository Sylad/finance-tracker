import type { Transaction } from '@/types/api';
import { recognizeMerchant } from '@/lib/merchants';

export interface UncategorizedMerchant {
  label: string;
  count: number;
  total: number;
}

export interface CategorizationQuality {
  total: number;
  otherCount: number;
  /** Part des transactions classées « Autres », entre 0 et 1. */
  rate: number;
  topMerchants: UncategorizedMerchant[];
}

const BANK_PREFIX = /^(PAIEMENT CB|ACHAT CB|PRLV SEPA|PRLV|PRELEVT|PRELEVEMENT SEPA|PRELEVEMENT|VIR SEPA|VIR INST|VIR|CB)\s+/i;
const DATE = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g;
const NUMBER_SIGN = /\bN°\s*(?=\d{3,})/gi;
const NUMBER = /\b\d{3,}\b/g;

/** Libellé de marchand lisible : nom reconnu, sinon libellé bancaire débarrassé de son bruit. */
export function merchantLabel(description: string): string {
  const known = recognizeMerchant(description);
  if (known) return known.name;
  const cleaned = description
    .replace(BANK_PREFIX, '')
    .replace(DATE, ' ')
    .replace(NUMBER_SIGN, '')
    .replace(NUMBER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || description).toUpperCase();
}

/** Mesure de la qualité de catégorisation d'un relevé : taux d'« Autres » et marchands à classer. */
export function categorizationQuality(transactions: Transaction[], limit = 5): CategorizationQuality {
  const others = transactions.filter((t) => t.category === 'other');
  const groups = new Map<string, UncategorizedMerchant>();
  for (const t of others) {
    if (t.amount >= 0) continue;
    const label = merchantLabel(t.description);
    const g = groups.get(label) ?? { label, count: 0, total: 0 };
    g.count += 1;
    g.total += Math.abs(t.amount);
    groups.set(label, g);
  }
  const topMerchants = [...groups.values()]
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
  return {
    total: transactions.length,
    otherCount: others.length,
    rate: transactions.length === 0 ? 0 : others.length / transactions.length,
    topMerchants,
  };
}
