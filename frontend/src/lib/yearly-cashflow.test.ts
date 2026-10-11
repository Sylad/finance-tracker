// L65 — le graphique « Cash flow mensuel » trace des euros, pas le score.
import { describe, expect, it } from 'vitest';
import { cashFlowSeries } from './yearly-cashflow';
import type { YearlySummary } from '@/types/api';

const base = {
  year: 2025,
  scoreProgression: [{ month: 1, score: 40 }, { month: 2, score: 80 }],
} as unknown as YearlySummary;

describe('cashFlowSeries', () => {
  it('trace entrées et sorties en €, jamais le score', () => {
    const s = cashFlowSeries({
      ...base,
      monthlyCashFlow: [
        { month: 1, credits: 2000, debits: 2300.5, net: -300.5 },
        { month: 2, credits: 2100, debits: 1900, net: 200 },
      ],
    });
    expect(s).toEqual([
      { label: 'Jan 25', credits: 2000, debits: 2300.5 },
      { label: 'Fév 25', credits: 2100, debits: 1900 },
    ]);
    expect(s.every((p) => !('score' in p))).toBe(true);
  });

  it('bilan sans flux (ancien format) → série vide, pas de repli sur le score', () => {
    expect(cashFlowSeries(base)).toEqual([]);
  });
});
