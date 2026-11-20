import { formatMonth, formatMonthShort } from './utils';

/**
 * L182 — un mois (`YYYY-MM`) s'écrit d'une seule façon par usage :
 * - dans le texte (phrases, infobulles, tableaux, listes) : `monthLabel` → « juillet 2026 » ;
 * - sur un axe de graphique, où la place manque : `monthAxisLabel` → « Juil 26 ».
 * Aucun écran de /loans n'écrit un mois autrement (test `month-label.test.ts`).
 */
function parse(ym: string): [month: number, year: number] {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) throw new Error(`Mois invalide : ${ym}`);
  return [Number(m[2]), Number(m[1])];
}

/** Forme de texte : « juillet 2026 », « août 2026 ». */
export function monthLabel(ym: string): string {
  const [month, year] = parse(ym);
  return formatMonth(month, year).toLowerCase();
}

/** Forme courte, réservée aux graduations d'axe : « Juil 26 ». */
export function monthAxisLabel(ym: string): string {
  const [month, year] = parse(ym);
  return formatMonthShort(month, year);
}
