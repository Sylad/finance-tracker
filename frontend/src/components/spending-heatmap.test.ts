import { describe, expect, it } from 'vitest';
import { buildHeatmapGrid, dateKey } from './spending-heatmap';

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
