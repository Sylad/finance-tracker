import type { Loan, LoanInput } from '@/types/api';

/** Convert a persisted Loan back to the input shape the form edits. */
export function toLoanInput(l: Loan): LoanInput {
  const { id: _i, occurrencesDetected: _o, createdAt: _c, updatedAt: _u, ...rest } = l;
  void _i; void _o; void _c; void _u;
  return rest;
}

/**
 * Detect how many distinct sub-credits are hiding inside a single loan, by
 * clustering its detected occurrences by amount within ±5%.
 *
 * Mirrors the backend's `splitByAmount` heuristic (≥3 distinct months,
 * ≤1/month, ≥4 months for amounts <30€). Returns the number of valid
 * groups; 0 or 1 means nothing to split.
 */
export function detectAmountGroups(loan: Loan): number {
  // Filter to debits only (loans are negative), ≥ 2 occurrences needed.
  const debits = loan.occurrencesDetected.filter((o) => o.amount < 0);
  if (debits.length < 2) return 0;

  const extractAll = (d: string | undefined) => (d ? [...d.matchAll(/\d{8,}/g)].map((m) => m[0]) : []);
  const refCounts = new Map<string, number>();
  for (const o of debits) for (const r of extractAll(o.description)) refCounts.set(r, (refCounts.get(r) ?? 0) + 1);
  const stableRef = (d: string | undefined) => {
    const refs = extractAll(d).filter((r) => (refCounts.get(r) ?? 0) >= 2);
    if (refs.length === 0) return '';
    return refs.sort((a, b) => (b.length !== a.length ? b.length - a.length : (refCounts.get(b) ?? 0) - (refCounts.get(a) ?? 0)))[0];
  };

  type Bucket = { amount: number; ref: string; occurrences: typeof debits };
  const refGroups = new Map<string, typeof debits>();
  for (const o of debits) {
    const ref = stableRef(o.description);
    if (!refGroups.has(ref)) refGroups.set(ref, []);
    refGroups.get(ref)!.push(o);
  }
  const all: Bucket[] = [];
  for (const [ref, occList] of refGroups.entries()) {
    const sorted = [...occList].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    const buckets: Bucket[] = [];
    for (const o of sorted) {
      const amt = Math.abs(o.amount);
      const last = buckets[buckets.length - 1];
      const lastAvg = last ? last.occurrences.reduce((s, x) => s + Math.abs(x.amount), 0) / last.occurrences.length : 0;
      if (last && Math.abs(amt - lastAvg) <= lastAvg * 0.05) last.occurrences.push(o);
      else buckets.push({ amount: Math.round(amt), ref, occurrences: [o] });
    }
    all.push(...buckets);
  }

  let validGroups = 0;
  for (const g of all) {
    const monthsSeen = new Set(g.occurrences.map((o) => o.date.slice(0, 7)));
    const maxPerMonth = Math.max(...[...monthsSeen].map((m) => g.occurrences.filter((o) => o.date.startsWith(m)).length));
    const minMonths = g.amount < 30 ? 4 : 3;
    if (monthsSeen.size >= minMonths && maxPerMonth <= 1) validGroups++;
  }
  return validGroups;
}

/** 12-color palette used to stack each loan in the monthly chart. */
export const LOAN_COLORS = [
  'hsl(160 84% 50%)', 'hsl(217 91% 60%)', 'hsl(45 93% 50%)', 'hsl(280 85% 65%)',
  'hsl(0 84% 60%)', 'hsl(330 85% 60%)', 'hsl(195 83% 50%)', 'hsl(38 92% 55%)',
  'hsl(120 70% 50%)', 'hsl(260 80% 65%)', 'hsl(20 90% 55%)', 'hsl(180 70% 45%)',
];
