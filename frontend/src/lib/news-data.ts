// Journal généré par `cadence news build` (npm run news à la racine) :
// les entrées vivent dans docs/nouveautes/, le build est servi en statique.
// Partagé par les pages Nouveautés et Plan de travail (L48).
export const NEWS_BASE = '/nouveautes-data';

export interface NewsEntry {
  slug: string;
  title: string;
  date: string;
  lots: string[];
  captures: string[];
  html: string;
}

export interface NewsData {
  project: string;
  generated: string;
  entries: NewsEntry[];
}

export async function fetchNews(): Promise<NewsData | null> {
  const res = await fetch(`${NEWS_BASE}/nouveautes.json`, { cache: 'no-cache' });
  // 404 : aucun journal publié (page vide). Toute autre réponse en échec est une panne, dite comme telle.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`nouveautes.json : HTTP ${res.status}`);
  return res.json();
}

export const NEWS_QUERY_KEY = ['nouveautes'] as const;

/** Capture → [largeur, hauteur] en pixels (tailles.json, écrit par `npm run news`, L47). */
export type NewsSizes = Record<string, [number, number]>;
export const NEWS_SIZES_QUERY_KEY = ['nouveautes', 'tailles'] as const;

/** Tailles réelles des captures ; {} si absentes ou illisibles (les captures s'affichent quand même). */
export async function fetchNewsSizes(): Promise<NewsSizes> {
  try {
    const res = await fetch(`${NEWS_BASE}/tailles.json`, { cache: 'no-cache' });
    if (!res.ok) return {};
    const data: unknown = await res.json();
    return data && typeof data === 'object' ? (data as NewsSizes) : {};
  } catch {
    return {};
  }
}

/** Jour (AAAA-MM-JJ) en toutes lettres, sans décalage de fuseau ; « 1er » pour le premier du mois (L47). */
export function formatNewsDay(day: string): string {
  const text = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return text.replace(/^1 /, '1er ');
}
