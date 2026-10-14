/**
 * Deux normalisations de libellé, volontairement distinctes (L15) :
 * - `foldAccents` : minuscules + sans accents + trim, ponctuation CONSERVÉE
 *   (comparaison par sous-chaîne, ex. créancier ↔ libellé bancaire) ;
 * - `slugify` : idem, puis toute suite non alphanumérique → un espace
 *   (comparaison par mots / égalité de noms).
 */
export function foldAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function slugify(s: string): string {
  return foldAccents(s).replace(/[^a-z0-9]+/g, ' ').trim();
}
