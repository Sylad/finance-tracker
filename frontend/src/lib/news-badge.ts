// L47 — pastille « nouveau » des Nouveautés : combien d'entrées le visiteur n'a pas
// encore vues depuis sa dernière visite (localStorage). Module pur, porté de
// l'état final d'ol-companion L22 et de warhammer40k L34 (après leurs revues).
//
// Mémoire : date de l'entrée la plus récente vue + slugs de cette date + TOUS les
// slugs vus (une entrée antidatée publiée après la visite reste nouvelle) + instant
// de la visite. La ligne de base d'un nouveau venu n'a pas d'instant de visite.
// Dates comparées en millisecondes, jamais en chaînes. Premier visiteur : rien
// n'est nouveau. Aucune mémoire n'existait avant L47 dans cette application.

export const NEWS_SEEN_KEY = 'finance.news.seen-v1';

/** Événement émis après la visite de /nouveautes : la navigation relit la mémoire. */
export const NEWS_SEEN_EVENT = 'finance:news-seen';

export interface NewsSeen {
  /** Date (AAAA-MM-JJ) ou instant (AAAA-MM-JJTHH:MM[:SS]Z) de l'entrée la plus récente vue. */
  date: string;
  /** Slugs vus portant cette date. */
  slugs: string[];
  /** Tous les slugs vus. Absent (mémoire d'une autre forme) : règle par date. */
  seen?: string[];
  /** Instant de la visite de /nouveautes (ISO) ; absent pour la ligne de base. */
  at?: string;
}

export interface DatedEntry {
  slug: string;
  date: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DATE_OR_INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z)?$/;

/** Millisecondes UTC d'une date ou d'un instant ; NaN si illisible. */
function instant(d: string): number {
  return DATE_OR_INSTANT.test(d) ? Date.parse(d) : NaN;
}

const strings = (a: unknown[]) => a.filter((s): s is string => typeof s === 'string');

export function readSeen(storage: StorageLike | null): NewsSeen | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(NEWS_SEEN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { date, slugs, seen, at } = parsed as { date?: unknown; slugs?: unknown; seen?: unknown; at?: unknown };
    if (typeof date !== 'string' || Number.isNaN(instant(date)) || !Array.isArray(slugs)) return null;
    return {
      date,
      slugs: strings(slugs),
      ...(Array.isArray(seen) ? { seen: strings(seen) } : {}),
      ...(typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? { at } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Marque toutes les entrées comme vues ; retourne ce qui a été mémorisé.
 * `visit: false` — ligne de base d'un nouveau venu : pas d'instant de visite.
 */
export function markAllSeen(
  storage: StorageLike | null,
  entries: readonly DatedEntry[],
  now: Date = new Date(),
  { visit = true }: { visit?: boolean } = {},
): NewsSeen | null {
  if (!entries.length) return null;
  const date = entries.reduce((max, e) => (instant(e.date) > instant(max) ? e.date : max), entries[0].date);
  const seen: NewsSeen = {
    date,
    slugs: entries.filter((e) => instant(e.date) === instant(date)).map((e) => e.slug).sort(),
    seen: entries.map((e) => e.slug).sort(),
    ...(visit ? { at: now.toISOString() } : {}),
  };
  try {
    storage?.setItem(NEWS_SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* stockage plein ou refusé : la pastille restera, rien ne casse */
  }
  return seen;
}

/** Entrée non vue lors de la visite `seen` ; premier visiteur (null) : rien n'est nouveau. */
export function isUnseen(entry: DatedEntry, seen: NewsSeen | null): boolean {
  if (!seen) return false;
  if (seen.seen) return !seen.seen.includes(entry.slug);
  return !seen.slugs.includes(entry.slug) && instant(entry.date) >= instant(seen.date);
}

export function countUnseen(entries: readonly DatedEntry[], seen: NewsSeen | null): number {
  return entries.filter((e) => isUnseen(e, seen)).length;
}

/**
 * Place du séparateur « Déjà vu… » : avant la première entrée déjà vue, seulement si
 * TOUTES les nouvelles sont au-dessus (une entrée antidatée peut être nouvelle plus
 * bas : un séparateur mentirait). -1 : pas de séparateur.
 */
export function seenSeparatorIndex(fresh: readonly boolean[]): number {
  const firstSeen = fresh.indexOf(false);
  if (firstSeen <= 0) return -1;
  return fresh.indexOf(true, firstSeen) === -1 ? firstSeen : -1;
}

/**
 * Libellé du séparateur. Sans instant de visite, la mémoire est la ligne de base
 * posée au premier passage dans l'application : ces entrées étaient publiées, pas « vues ».
 */
export function seenSeparatorLabel(seen: NewsSeen, timeZone?: string): string {
  if (!seen.at) return "Déjà publié lors de votre première visite de l'application";
  const when = new Date(seen.at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone });
  return `Déjà vu lors de votre visite du ${when.replace(/^1 /, '1er ')}`;
}

/** Libellé de la pastille : vide à zéro, « 9+ » au-delà de neuf. */
export function badgeLabel(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/** Texte pour lecteur d'écran (la pastille seule n'est qu'un chiffre sur une forme colorée). */
export function unseenLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 nouveauté non vue' : `${count} nouveautés non vues`;
}

/**
 * Ligne d'annonce en tête de la page Nouveautés. Mémoire sans instant de visite (ligne
 * de base) : « depuis votre première visite », comme le séparateur (revue UX L47).
 */
export function sinceLabel(count: number, seen?: NewsSeen | null): string {
  if (count <= 0) return '';
  const since = seen && !seen.at ? 'votre première visite' : 'votre dernière visite';
  return `${count} ${count === 1 ? 'nouveauté' : 'nouveautés'} depuis ${since}`;
}

/** localStorage, ou null s'il est inaccessible (navigation privée stricte, iframe…). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
