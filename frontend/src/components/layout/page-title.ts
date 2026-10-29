import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';

const APP_NAME = 'Finance Tracker';

/** Titre d'onglet d'une page (WCAG 2.4.2) : « Crédits — Finance Tracker ». Page inconnue : le nom de l'app. */
export function pageTitle(path: string): string {
  const all = [...NAV_ITEMS, ...SECONDARY_ITEMS] as readonly { to: string; label: string }[];
  const hit = all.find((i) => (i.to === '/' ? path === '/' : path === i.to || path.startsWith(`${i.to}/`)));
  return hit ? `${hit.label} — ${APP_NAME}` : APP_NAME;
}
