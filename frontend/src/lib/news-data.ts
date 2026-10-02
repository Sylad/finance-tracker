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
  if (!res.ok) return null;
  return res.json();
}

export const NEWS_QUERY_KEY = ['nouveautes'] as const;

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
