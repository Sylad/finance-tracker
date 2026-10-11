/**
 * Recalage des fixtures de la démo (L63) : elles s'arrêtent en mars 2026 ; sans
 * recalage, `getLoanHealth` (fenêtre de 180 j avant la date du jour) classe tous
 * les crédits en « Trou ». Décalage de mois entiers, appliqué à toute date,
 * identifiant et numéro de mois des fixtures — jamais aux calculs eux-mêmes.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;
const EMBEDDED_MONTH = /(?<!\d)(20\d{2})-(0[1-9]|1[0-2])(?!\d)/g;
const COMPACT_DATE = /(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g;

/** Mois à ajouter pour que le dernier relevé soit le mois précédant `now` (jamais négatif). */
export function monthsToShift(lastYear: number, lastMonth: number, now: Date): number {
  const target = now.getUTCFullYear() * 12 + now.getUTCMonth() - 1;
  return Math.max(0, target - (lastYear * 12 + lastMonth - 1));
}

const pad = (n: number) => String(n).padStart(2, '0');

function addMonths(year: number, month: number, n: number): [number, number] {
  const idx = year * 12 + month - 1 + n;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

function shiftDay(year: number, month: number, day: number, n: number): [number, number, number] {
  const [y, m] = addMonths(year, month, n);
  return [y, m, Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())];
}

function shiftString(s: string, n: number): string {
  const iso = ISO_DATE.exec(s);
  if (iso && !/\d$/.test(iso[4])) {
    const [y, m, d] = shiftDay(+iso[1], +iso[2], +iso[3], n);
    return `${y}-${pad(m)}-${pad(d)}${iso[4]}`;
  }
  // « 2026-03 » (identifiants de relevé, d'occurrence, de transaction)
  const withMonths = s.replace(EMBEDDED_MONTH, (_, y: string, m: string) => {
    const [ny, nm] = addMonths(+y, +m, n);
    return `${ny}-${pad(nm)}`;
  });
  // Date compacte 20260309 : seulement dans un nom de fichier .pdf
  return /\.pdf$/i.test(withMonths)
    ? withMonths.replace(COMPACT_DATE, (_, y: string, m: string, d: string) => {
        const [ny, nm, nd] = shiftDay(+y, +m, +d, n);
        return `${ny}${pad(nm)}${pad(nd)}`;
      })
    : withMonths;
}

const YEAR_MONTH_KEYS: [string, string][] = [
  ['year', 'month'],
  ['statementYear', 'statementMonth'],
];

function shiftNode(node: unknown, n: number): unknown {
  if (typeof node === 'string') return shiftString(node, n);
  if (Array.isArray(node)) return node.map((x) => shiftNode(x, n));
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = shiftNode(v, n);
  for (const [yk, mk] of YEAR_MONTH_KEYS) {
    if (typeof src[yk] === 'number' && typeof src[mk] === 'number') {
      [out[yk], out[mk]] = addMonths(src[yk] as number, src[mk] as number, n);
    }
  }
  return out;
}

/** Copie des fixtures décalée de `months` mois ; l'entrée n'est pas modifiée. */
export function shiftDemoFixtures<T extends Record<string, unknown>>(fixtures: T, months: number): T {
  return months === 0 ? fixtures : (shiftNode(fixtures, months) as T);
}
