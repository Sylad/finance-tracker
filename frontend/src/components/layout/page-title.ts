import { useEffect } from 'react';
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
 *
 * Une sous-page (détail) nomme son objet devant sa page parente (L173) :
 * « Octobre 2026 — Historique — Finance Tracker ». `detail` n'est lu que sur une sous-page :
 * un nom resté d'une page de détail quittée ne déborde jamais sur une autre page.
 */
export function pageTitle(path: string, detail?: string | null): string {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const all = [...NAV_ITEMS, ...SECONDARY_ITEMS] as readonly { to: string; label: string }[];
  const sub = SUB_PAGES.find((s) => s.pattern.test(p));
  const hit = all.find((i) => i.to === (sub ? sub.parent : p));
  if (!hit) return `Page introuvable — ${APP_NAME}`;
  const name = sub && detail ? `${detail} — ${hit.label}` : hit.label;
  return `${name} — ${APP_NAME}`;
}

// Nom de l'objet affiché par la page de détail courante, posé par usePageTitleDetail et lu
// par AppShell, qui seul écrit document.title (sinon son effet, qui passe après celui de la
// page, écraserait le titre).
let currentDetail: string | null = null;
const listeners = new Set<() => void>();

export const pageTitleDetailStore = {
  get: (): string | null => currentDetail,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  set(detail: string | null): void {
    if (detail === currentDetail) return;
    currentDetail = detail;
    listeners.forEach((l) => l());
  },
};

/** Une page de détail nomme ce qu'elle montre dans le titre d'onglet ; retiré au démontage. */
export function usePageTitleDetail(detail: string | null): void {
  useEffect(() => {
    pageTitleDetailStore.set(detail);
    return () => pageTitleDetailStore.set(null);
  }, [detail]);
}
