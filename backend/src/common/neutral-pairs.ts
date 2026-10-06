export interface NeutralCandidate {
  id: string;
  date: string;
  amount: number;
  description: string;
}

export interface NeutralPair {
  outId: string;
  inId: string;
  outAmount: number;
}

const MAX_GAP_MS = 7 * 24 * 3600 * 1000;
const AMOUNT_TOLERANCE = 0.01;

/**
 * Paires « neutres » : un débit compensé par un crédit de même montant
 * (±0,01 €) à ≤ 7 jours (remboursement redirigé, annulation). Source unique
 * pour /health et /expenses (le lot L6 existe parce que deux copies avaient
 * divergé). Sont écartées AVANT l'appariement : les transactions à 0 €, celles
 * de `excludedTxIds` (déjà allouées à un crédit, abonnement ou épargne) et
 * celles dont le libellé matche un `matchPattern` de crédit actif (regex libre
 * de l'utilisateur : un motif invalide est ignoré). Appariement glouton par
 * écart de dates croissant ; chaque transaction entre dans une paire au plus.
 */
export function pairNeutralTransactions(
  transactions: NeutralCandidate[],
  excludedTxIds: Set<string> = new Set(),
  loanMatchPatterns: string[] = [],
): NeutralPair[] {
  const patterns: RegExp[] = [];
  for (const p of loanMatchPatterns) {
    try {
      patterns.push(new RegExp(p, 'i'));
    } catch {
      // matchPattern invalide (saisie libre) — ignoré.
    }
  }
  const eligible = transactions.filter(
    (t) =>
      t.amount !== 0 &&
      !excludedTxIds.has(t.id) &&
      !patterns.some((re) => re.test(t.description)),
  );
  const debits = eligible.filter((t) => t.amount < 0);
  const credits = eligible.filter((t) => t.amount > 0);
  const candidates: (NeutralPair & { gap: number })[] = [];
  for (const d of debits) {
    for (const c of credits) {
      if (Math.abs(c.amount + d.amount) > AMOUNT_TOLERANCE) continue;
      const gap = Math.abs(new Date(c.date).getTime() - new Date(d.date).getTime());
      if (gap <= MAX_GAP_MS) candidates.push({ outId: d.id, inId: c.id, outAmount: Math.abs(d.amount), gap });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);
  const usedOut = new Set<string>();
  const usedIn = new Set<string>();
  const pairs: NeutralPair[] = [];
  for (const { gap: _gap, ...pair } of candidates) {
    if (usedOut.has(pair.outId) || usedIn.has(pair.inId)) continue;
    usedOut.add(pair.outId);
    usedIn.add(pair.inId);
    pairs.push(pair);
  }
  return pairs;
}
