// L47 — lien permanent `/nouveautes#<slug>` d'une entrée des Nouveautés (porté
// d'ol-companion L22). Module pur. La page ne s'affiche qu'une fois le JSON chargé :
// le défilement natif vers l'ancre ne trouve rien à l'arrivée, c'est la page qui
// vise l'entrée ensuite.

/** Slug visé par un fragment d'URL (avec ou sans « # », encodé ou non) ; null s'il n'existe pas. */
export function entryForFragment(
  fragment: string | null | undefined,
  entries: readonly { slug: string }[],
): string | null {
  const raw = (fragment ?? '').replace(/^#/, '');
  if (!raw) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return entries.some((e) => e.slug === slug) ? slug : null;
}

/** URL absolue d'une entrée, à copier ou partager. */
export function permalink(origin: string, slug: string): string {
  return `${origin}/nouveautes#${encodeURIComponent(slug)}`;
}
