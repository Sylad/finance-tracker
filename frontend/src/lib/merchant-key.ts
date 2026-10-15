/**
 * Miroir de `merchantKey` du backend (category-rules/merchant-dictionary.ts,
 * R1/R2/R18) : sert uniquement à nommer le marchand mémorisé dans le sélecteur
 * de catégorie. Le backend reste la référence.
 */
const LEADING_PREFIXES = new Set([
  'CB', 'PAIEMENT', 'ACHAT', 'CARTE', 'PRELEVEMENT', 'PRELEVT', 'PRLV', 'VIR', 'VIREMENT',
]);

export function merchantKey(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && !/\d/.test(w));
  let i = 0;
  while (i < words.length && LEADING_PREFIXES.has(words[i])) {
    const wasCard = words[i] === 'CARTE';
    i++;
    if (wasCard && words[i] === 'X') i++;
  }
  return words.slice(i).join(' ');
}
