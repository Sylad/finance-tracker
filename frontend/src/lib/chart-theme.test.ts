import { describe, it, expect } from 'vitest';
import { CHART_FONT_SIZE, chartTick, chartTickCurrentColor, chartLegendStyle } from './chart-theme';
import { chartTooltipProps } from './utils';

/**
 * L170 (revue UX L169) : graduations, légendes et infobulles des graphiques à
 * 12 px minimum, via la constante de thème unique `CHART_FONT_SIZE`.
 */
const MIN = 12;

const sources = Object.entries(
  import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.spec.{ts,tsx}'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
).map(([file, src]) => [file, String(src)] as const);

/** Fichiers qui dessinent un graphique ou en portent le thème. */
const chartFiles = sources.filter(([file, src]) =>
  /from 'recharts'/.test(src) || /chart-theme/.test(src) || file.endsWith('/chart-theme.ts'),
);

describe('taille du texte des graphiques (L170)', () => {
  it('la constante de thème vaut au moins 12 px et tout le thème la porte', () => {
    expect(CHART_FONT_SIZE).toBeGreaterThanOrEqual(MIN);
    expect(chartTick.fontSize).toBe(CHART_FONT_SIZE);
    expect(chartTickCurrentColor.fontSize).toBe(CHART_FONT_SIZE);
    expect(chartLegendStyle.fontSize).toBe(CHART_FONT_SIZE);
    expect(chartTooltipProps.contentStyle.fontSize).toBe(CHART_FONT_SIZE);
  });

  it('les graphiques existent bien dans le balayage', () => {
    // Garde-fou du test lui-même : un glob vide passerait tout.
    expect(chartFiles.map(([f]) => f)).toEqual(
      expect.arrayContaining([
        '../components/loans/amortization-chart.tsx',
        '../components/dashboard/yearly-charts.tsx',
        '../components/loans/loans-monthly-chart.tsx',
        '../components/dashboard/balance-trend-chart.tsx',
        '../components/dashboard/score-trend-chart.tsx',
      ]),
    );
  });

  it('aucun fontSize de graphique sous 12 px', () => {
    const offenders: string[] = [];
    for (const [file, src] of chartFiles) {
      for (const m of src.matchAll(/fontSize\s*[:=]\s*\{?\s*(\d+(?:\.\d+)?)/g)) {
        if (Number(m[1]) < MIN) offenders.push(`${file}: ${m[0]}`);
      }
      for (const m of src.matchAll(/font-size\s*[:=]\s*["']?(\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) < MIN) offenders.push(`${file}: ${m[0]}`);
      }
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) < MIN) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('aucun graphique ne fixe une taille en dur : il passe par le thème', () => {
    const offenders: string[] = [];
    for (const [file, src] of chartFiles) {
      if (file.endsWith('/chart-theme.ts')) continue;
      for (const m of src.matchAll(/fontSize\s*:\s*\d/g)) offenders.push(`${file}: ${m[0]}`);
      // Une graduation d'axe en objet littéral contournerait la constante.
      for (const m of src.matchAll(/\btick=\{\{/g)) offenders.push(`${file}: ${m[0]}`);
      if (/<(XAxis|YAxis)\b/.test(src) && !/\btick=\{chartTick/.test(src) && !/<(XAxis|YAxis)[^>]*\bhide\b/.test(src)) {
        offenders.push(`${file}: axe sans tick={chartTick…}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le test attrape bien un fontSize trop petit (contrôle négatif)', () => {
    const bad = "tick={{ fill: 'x', fontSize: 9 }}";
    const hits = [...bad.matchAll(/fontSize\s*[:=]\s*\{?\s*(\d+(?:\.\d+)?)/g)].filter((m) => Number(m[1]) < MIN);
    expect(hits).toHaveLength(1);
  });
});
