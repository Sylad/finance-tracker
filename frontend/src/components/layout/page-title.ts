import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';

const APP_NAME = 'Finance Tracker';

/**
 * Sous-pages du routeur, sous la page de navigation qui leur donne leur titre : seul
 * `/history/$id` (router.tsx) existe. Un autre sous-chemin (`/plan/x`, `/loans/x`,
 * `/history/2026-03/x`) n'est pas une page : l'écran 404 s'affiche, son titre aussi (L169).
 */
const SUB_PAGES: readonly { parent: string; pattern: RegExp }[] = [
  { parent: '/history', pattern: /^\/history\/[^/]+$/ },
];

/**
 * Titre d'onglet d'une page (WCAG 2.4.2) : « Crédits — Finance Tracker ». Chemin inconnu :
 * « Page introuvable », celui de l'écran 404 (L169) — toute route du routeur a son entrée
 * de navigation (vérifié par app-shell.test.tsx).
 */
export function pageTitle(path: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const all = [...NAV_ITEMS, ...SECONDARY_ITEMS] as readonly { to: string; label: string }[];
  const sub = SUB_PAGES.find((s) => s.pattern.test(p));
  const hit = all.find((i) => i.to === (sub ? sub.parent : p));
  return `${hit ? hit.label : 'Page introuvable'} — ${APP_NAME}`;
}
