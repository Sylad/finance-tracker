import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';

const APP_NAME = 'Finance Tracker';

/**
 * Titre d'onglet d'une page (WCAG 2.4.2) : « Crédits — Finance Tracker ». Chemin inconnu :
 * « Page introuvable », celui de l'écran 404 (L169) — toute route du routeur a son entrée
 * de navigation (vérifié par app-shell.test.tsx).
 */
export function pageTitle(path: string): string {
  const all = [...NAV_ITEMS, ...SECONDARY_ITEMS] as readonly { to: string; label: string }[];
  const hit = all.find((i) => (i.to === '/' ? path === '/' : path === i.to || path.startsWith(`${i.to}/`)));
  return `${hit ? hit.label : 'Page introuvable'} — ${APP_NAME}`;
}
