/**
 * Thème typographique des graphiques Recharts (L170).
 *
 * Graduations, légendes et infobulles de TOUS les graphiques lisent leur taille
 * ici, jamais un nombre en dur : 12 px minimum (revue UX L169 — WCAG 1.4.4 /
 * lisibilité au téléphone ; 12 px = `text-xs`, le plus petit corps de l'app).
 * `chart-theme.test.ts` refuse tout `fontSize` de graphique sous ce plancher.
 */
export const CHART_FONT_SIZE = 12;

/** Graduations d'axe (`<XAxis tick={chartTick} />`). */
export const chartTick = { fill: 'hsl(var(--fg-dim))', fontSize: CHART_FONT_SIZE } as const;

/** Graduations d'axe héritant de la couleur du texte parent (`currentColor`). */
export const chartTickCurrentColor = { fill: 'currentColor', fontSize: CHART_FONT_SIZE } as const;

/** Conteneur de `<Legend />` (`wrapperStyle`). */
export const chartLegendStyle = { fontSize: CHART_FONT_SIZE } as const;
