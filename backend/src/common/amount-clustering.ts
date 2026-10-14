/** Tolérance de rattachement à un cluster de montants (±5 %). */
export const AMOUNT_CLUSTER_TOLERANCE = 0.05;

/**
 * Clustering glouton par montant : tri par montant absolu croissant, un
 * élément rejoint le dernier bucket si son montant est à ±5 % de la moyenne
 * courante de ce bucket. Source unique du découpage en sous-crédits
 * (`LoansService`) et des sous-séries de la détection
 * (`DetectionValidatorService.splitByAmount`).
 */
export function clusterByAmount<T>(
  items: readonly T[],
  getAmount: (item: T) => number,
  tolerance: number = AMOUNT_CLUSTER_TOLERANCE,
): T[][] {
  const sorted = [...items].sort(
    (a, b) => Math.abs(getAmount(a)) - Math.abs(getAmount(b)),
  );
  const buckets: T[][] = [];
  for (const item of sorted) {
    const amt = Math.abs(getAmount(item));
    const last = buckets[buckets.length - 1];
    const lastAvg = last
      ? last.reduce((s, x) => s + Math.abs(getAmount(x)), 0) / last.length
      : 0;
    if (last && Math.abs(amt - lastAvg) <= lastAvg * tolerance) {
      last.push(item);
    } else {
      buckets.push([item]);
    }
  }
  return buckets;
}
