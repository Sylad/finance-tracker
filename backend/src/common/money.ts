/** Arrondi au centime. Source unique (ex-copies dans health, forecast, goals…). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Montant à deux décimales avec la virgule française (« 240,00 »), sans symbole : pour les noms de crédits. */
export function formatDecimalFr(n: number): string {
  return n.toFixed(2).replace('.', ',');
}
