import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Loan } from '../../models/loan.model';

export interface IncomeDetection {
  monthly: number | null;
  source: 'detected' | 'manual' | 'transition' | 'unavailable';
  label: string | null;
}

const MONTH_WORDS = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/g;
const GENERIC_TOKENS = new Set([
  'salaire', 'salary', 'wage', 'wages', 'paie', 'remuneration', 'rémunération',
  'virement', 'vir', 'de', 'du', 'sepa', 'sa', 'sas', 's.a.s.', 's.a.s'
]);
const MIN_AMOUNT = 200;
const STABILITY_TOLERANCE = 0.25;
const MIN_DISTINCT_MONTHS = 3;

export function collectDrawTxIds(loans: Loan[]): Set<string> {
  const ids = new Set<string>();
  for (const l of loans) {
    for (const o of l.occurrencesDetected) {
      if (o.source === 'draw' && o.transactionId) ids.add(o.transactionId);
    }
  }
  return ids;
}

function clusterKey(description: string): string {
  const cleaned = description.toLowerCase()
    .replace(MONTH_WORDS, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-zà-ÿ.\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !GENERIC_TOKENS.has(t));
  const tokens = cleaned.slice(0, 4);
  return tokens.join(' ');
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function detectStableIncome(
  statements: MonthlyStatement[],
  drawTxIds: Set<string>,
  manualMonthlyIncome: number | null,
): IncomeDetection {
  if (manualMonthlyIncome != null) {
    return { monthly: manualMonthlyIncome, source: 'manual', label: null };
  }
  // Determine latestMonth from statement year/month (not transaction dates)
  let latestMonth = '';
  for (const st of statements) {
    const stmtMonth = `${st.year}-${String(st.month).padStart(2, '0')}`;
    if (stmtMonth > latestMonth) latestMonth = stmtMonth;
  }

  type Candidate = { month: string; amount: number };
  const clusters = new Map<string, Candidate[]>();
  for (const st of statements) {
    for (const t of st.transactions) {
      if (t.amount < MIN_AMOUNT || drawTxIds.has(t.id)) continue;
      const key = clusterKey(t.description);
      if (!key) continue;
      const month = t.date.slice(0, 7);
      const arr = clusters.get(key);
      if (arr) arr.push({ month, amount: t.amount });
      else clusters.set(key, [{ month, amount: t.amount }]);
    }
  }

  const qualified: { key: string; medianAmount: number; months: Set<string> }[] = [];
  for (const [key, occs] of clusters) {
    const months = new Set(occs.map((o) => o.month));
    if (months.size < MIN_DISTINCT_MONTHS) continue;
    if (occs.length / months.size > 1.5) continue;
    const med = median(occs.map((o) => o.amount));
    if (!occs.every((o) => Math.abs(o.amount - med) <= med * STABILITY_TOLERANCE)) continue;

    // Aggregate amounts by calendar month, then compute median of last 3 distinct months
    const amountsByMonth = new Map<string, number[]>();
    for (const occ of occs) {
      const arr = amountsByMonth.get(occ.month) || [];
      arr.push(occ.amount);
      amountsByMonth.set(occ.month, arr);
    }
    const monthSums = Array.from(amountsByMonth.entries())
      .map(([m, amounts]) => ({ month: m, sum: amounts.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const last3Sums = monthSums.slice(-3).map((ms) => ms.sum);
    const medianAmount = median(last3Sums);

    qualified.push({ key, medianAmount, months });
  }
  if (qualified.length === 0) return { monthly: null, source: 'unavailable', label: null };

  qualified.sort((a, b) => b.medianAmount - a.medianAmount);
  const main = qualified[0];
  // Transition emploi : cluster principal absent du dernier mois couvert,
  // mais un crédit non-tirage ≥ 50 % de sa médiane existe dans ce mois.
  if (latestMonth && !main.months.has(latestMonth)) {
    const successor = statements.some((st) => st.transactions.some((t) =>
      t.date.slice(0, 7) === latestMonth && t.amount >= main.medianAmount * 0.5 && !drawTxIds.has(t.id)));
    if (successor) {
      const total = qualified.reduce((s, q) => s + q.medianAmount, 0);
      return { monthly: Math.round(total * 100) / 100, source: 'transition', label: main.key };
    }
  }
  const total = qualified.reduce((s, q) => s + q.medianAmount, 0);
  return { monthly: Math.round(total * 100) / 100, source: 'detected', label: main.key };
}
