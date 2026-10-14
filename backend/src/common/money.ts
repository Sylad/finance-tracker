/** Arrondi au centime. Source unique (ex-copies dans health, forecast, goals…). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
