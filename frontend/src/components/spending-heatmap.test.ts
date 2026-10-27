import { describe, expect, it } from 'vitest';
import { buildHeatmapGrid, buildMonthTicks, compareSpendingDays, dateKey, EMPTY_CELL_COLOR, heatmapColor, heatmapIntensity } from './spending-heatmap';

// 2026-05-04 is a Monday → starts on column 0 (no leading null padding).
// 2026-05-10 is a Sunday → fills exactly one column of 7 cells.
const MONDAY_START = new Date(2026, 4, 4);  // 2026-05-04
const SUNDAY_END   = new Date(2026, 4, 10); // 2026-05-10
const TUESDAY_START = new Date(2026, 4, 5); // 2026-05-05

describe('dateKey', () => {
  it('formats a Date as YYYY-MM-DD with zero-padding', () => {
    expect(dateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(dateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('buildHeatmapGrid', () => {
  it('produces a single full column when range = exactly 1 ISO week (Mon→Sun)', () => {
    const byDay = new Map<string, number>();
    const grid = buildHeatmapGrid(byDay, MONDAY_START, SUNDAY_END);
    expect(grid.columns).toHaveLength(1);
    expect(grid.columns[0]).toHaveLength(7);
    // No null padding because we start on Monday
    expect(grid.columns[0].every((cell) => cell !== null)).toBe(true);
    expect(grid.max).toBe(0);
    expect(grid.total).toBe(0);
    expect(grid.daysCovered).toBe(0);
  });

  it('pads the first column with nulls when the range starts mid-week', () => {
    const byDay = new Map<string, number>();
    const grid = buildHeatmapGrid(byDay, TUESDAY_START, SUNDAY_END);
    // First column = 1 null pad (Monday) + 6 real days
    expect(grid.columns[0][0]).toBeNull();
    const realCellsFirstCol = grid.columns[0].filter((c) => c !== null);
    expect(realCellsFirstCol).toHaveLength(6);
  });

  it('aggregates max/total/daysCovered, ignoring zero-amount days', () => {
    const byDay = new Map<string, number>([
      ['2026-05-04', 12.5],   // Monday
      ['2026-05-06', 100],    // Wednesday
      ['2026-05-07', 0],      // explicit zero — must NOT count toward total/daysCovered
      ['2026-05-10', 7.5],    // Sunday
    ]);
    const grid = buildHeatmapGrid(byDay, MONDAY_START, SUNDAY_END);
    expect(grid.max).toBe(100);
    expect(grid.total).toBeCloseTo(120, 5);
    expect(grid.daysCovered).toBe(3);
  });

  it('pads the trailing column with nulls when range ends mid-week', () => {
    // Tue → Wed of the next week = 9 days starting at offset 1 in week 1
    const grid = buildHeatmapGrid(new Map(), TUESDAY_START, new Date(2026, 4, 13));
    // Last column should have at least one trailing null
    const lastCol = grid.columns[grid.columns.length - 1];
    expect(lastCol).toHaveLength(7);
    expect(lastCol.some((c) => c === null)).toBe(true);
  });
});

describe('buildMonthTicks', () => {
  it('R9 — un mois entamé en fin de colonne ne chevauche pas l’étiquette du suivant', () => {
    // 2026-10-30 (vendredi) → l'étiquette « Oct » tomberait juste à gauche de « Nov »
    const grid = buildHeatmapGrid(new Map(), new Date(2026, 9, 30), new Date(2026, 11, 20));
    const ticks = buildMonthTicks(grid.columns);
    expect(ticks.map((t) => t.label)).toEqual(['Nov', 'Déc']);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].col - ticks[i - 1].col).toBeGreaterThanOrEqual(3);
  });
});

describe('heatmapColor — contraste de l’échelle (L36)', () => {
  function luminance(css: string): number {
    const [h, s, l] = (css.match(/[\d.]+/g) ?? []).map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
  }
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  it('R12 — chaque case avec débit tranche d’au moins 3:1 sur une case vide, et plus de dépense = plus clair', () => {
    expect(heatmapColor(0)).toBe(EMPTY_CELL_COLOR);
    let previous = 0;
    for (const t of [0.01, 0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
      const color = heatmapColor(t);
      expect(contrast(color, EMPTY_CELL_COLOR)).toBeGreaterThanOrEqual(3);
      const lum = luminance(color);
      expect(lum).toBeGreaterThan(previous);
      previous = lum;
    }
  });

  it('R12 — un petit jour (10 €) et le plus gros (1 200 €) se distinguent d’au moins 3:1, avec l’intensité réellement appliquée', () => {
    const max = 1200;
    const small = heatmapColor(heatmapIntensity(10, max));
    const big = heatmapColor(heatmapIntensity(max, max));
    expect(contrast(small, big)).toBeGreaterThanOrEqual(3);
    // Le plus petit jour possible (1 €) reste lui aussi ≥ 3:1 sur la case vide…
    expect(contrast(heatmapColor(heatmapIntensity(1, max)), EMPTY_CELL_COLOR)).toBeGreaterThanOrEqual(3);
    // …et l'intensité est monotone, bornée à [0, 1].
    expect(heatmapIntensity(0, max)).toBe(0);
    expect(heatmapIntensity(max, max)).toBe(1);
    expect(heatmapIntensity(100, max)).toBeGreaterThan(heatmapIntensity(10, max));
    expect(heatmapIntensity(10, 0)).toBe(0);
  });
});

describe('compareSpendingDays — départage partagé résumé / Top 5 (L36)', () => {
  it('trie par montant décroissant puis, à égalité, du jour le plus récent au plus ancien', () => {
    const days = [
      { date: '2026-04-05', amount: 1200 },
      { date: '2026-09-05', amount: 1200 },
      { date: '2026-06-01', amount: 30 },
      { date: '2026-05-05', amount: 1200 },
    ];
    expect([...days].sort(compareSpendingDays).map((d) => d.date)).toEqual([
      '2026-09-05', '2026-05-05', '2026-04-05', '2026-06-01',
    ]);
  });
});
