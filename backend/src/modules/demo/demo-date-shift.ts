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

/**
 * Un intérêt de la démo (L130) doit rester le dernier jour réel d'un mois de 30 jours
 * pour que L127 s'observe ; le décalage de mois entiers ne le garantit pas (novembre
 * + 6 = mai, 31 jours). Il est ramené au 30 du mois de 30 jours (avril, juin,
 * septembre, novembre) le plus proche en arrière, son relevé suit.
 */
function snapInterestsToThirtyDayMonth(fixtures: Record<string, unknown>): void {
  const accounts = fixtures['savings-accounts'];
  if (!Array.isArray(accounts)) return;
  for (const account of accounts as { movements?: Record<string, unknown>[] }[]) {
    for (const m of account.movements ?? []) {
      const iso = m.source === 'interest' && typeof m.date === 'string' ? ISO_DATE.exec(m.date) : null;
      if (!iso) continue;
      let [y, mo] = [+iso[1], +iso[2]];
      while (new Date(Date.UTC(y, mo, 0)).getUTCDate() !== 30) [y, mo] = addMonths(y, mo, -1);
      m.date = `${y}-${pad(mo)}-30`;
      m.statementId = `${y}-${pad(mo)}`;
    }
  }
}

/** Copie des fixtures décalée de `months` mois ; l'entrée n'est pas modifiée. */
export function shiftDemoFixtures<T extends Record<string, unknown>>(fixtures: T, months: number): T {
  if (months === 0) return fixtures;
  const shifted = shiftNode(fixtures, months) as T;
  snapInterestsToThirtyDayMonth(shifted);
  return shifted;
}

/**
 * Les imports des fixtures datent du 9 du mois suivant le relevé : recalés, ceux
 * du 1er au 8 seraient dans le futur. Tout `uploadedAt` postérieur à `now` y est ramené.
 */
export function capUploadDates<T>(node: T, now: Date): T {
  const cap = now.toISOString();
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== 'object') return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      out[k] = k === 'uploadedAt' && typeof v === 'string' && v > cap ? cap : walk(v);
    }
    return out;
  };
  return walk(node) as T;
}
