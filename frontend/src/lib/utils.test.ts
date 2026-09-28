import { describe, expect, it } from 'vitest';
import {
  formatEUR,
  formatEURCompact,
  formatMonth,
  formatMonthShort,
  maskAccountNumber,
  prevMonthId,
} from './utils';

describe('formatEUR', () => {
  it('formats positive amounts in fr-FR with euro symbol', () => {
    // fr-FR currency uses NBSP-style separators; assert structurally instead
    // of by exact string to stay resilient across Node ICU builds.
    const out = formatEUR(1234.5);
    expect(out).toContain('1');
    expect(out).toContain('234');
    expect(out).toContain('50');
    expect(out).toContain('€');
  });

  it('does not prepend a + sign when signed=false (default)', () => {
    expect(formatEUR(42)).not.toMatch(/^\+/);
  });

  it('prepends + when signed=true and amount > 0', () => {
    expect(formatEUR(42, true)).toMatch(/^\+/);
  });

  it('does NOT prepend + for zero or negative amounts even when signed=true', () => {
    expect(formatEUR(0, true)).not.toMatch(/^\+/);
    expect(formatEUR(-12, true)).not.toMatch(/^\+/);
  });
});

describe('prevMonthId', () => {
  it('rewinds within the same year', () => {
    expect(prevMonthId('2026-05')).toBe('2026-04');
    expect(prevMonthId('2026-12')).toBe('2026-11');
  });

  it('crosses the year boundary (january -> previous december)', () => {
    expect(prevMonthId('2026-01')).toBe('2025-12');
  });

  it('returns null for malformed ids', () => {
    expect(prevMonthId('2026/05')).toBeNull();
    expect(prevMonthId('hello')).toBeNull();
    expect(prevMonthId('')).toBeNull();
  });
});

describe('formatMonth / formatMonthShort', () => {
  it('uses the canonical French names', () => {
    expect(formatMonth(1, 2026)).toBe('Janvier 2026');
    expect(formatMonth(8, 2026)).toBe('Août 2026');
    expect(formatMonth(12, 2026)).toBe('Décembre 2026');
  });

  it('shortens names and uses 2-digit year', () => {
    expect(formatMonthShort(1, 2026)).toBe('Jan 26');
    expect(formatMonthShort(8, 2026)).toBe('Aoû 26');
  });
});

describe('maskAccountNumber', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(maskAccountNumber(null)).toBe('');
    expect(maskAccountNumber(undefined)).toBe('');
    expect(maskAccountNumber('')).toBe('');
  });

  it('returns the cleaned number when it is short (<= 4 chars)', () => {
    expect(maskAccountNumber('1 2 3')).toBe('123');
    expect(maskAccountNumber('1234')).toBe('1234');
  });

  it('masks all but the last 4 digits and strips whitespace', () => {
    expect(maskAccountNumber('1234 5678 9012 3456')).toBe('••••3456');
  });
});

describe('formatEURCompact (graduations des axes, L21/t5)', () => {
  const norm = (s: string) => s.replace(/[  ]/g, ' ');

  it('reste en euros entiers sous 10 000 € (pas de « 1 k » ambigu)', () => {
    expect(norm(formatEURCompact(0))).toBe('0 €');
    expect(norm(formatEURCompact(500))).toBe('500 €');
    expect(norm(formatEURCompact(1500))).toBe('1 500 €');
    expect(norm(formatEURCompact(9999))).toBe('9 999 €');
  });

  it('abrège en fr-FR (k €, M €) à partir de 10 000 €', () => {
    expect(norm(formatEURCompact(10_000))).toBe('10 k €');
    expect(norm(formatEURCompact(12_500))).toBe('12,5 k €');
    expect(norm(formatEURCompact(2_000_000))).toBe('2 M €');
  });

  it('garde le signe des montants négatifs', () => {
    expect(norm(formatEURCompact(-246165))).toMatch(/^-246,17 k €$/);
  });

  it.each([
    [[0, 500, 1000, 1500, 2000]],
    [[0, 450, 900, 1350, 1800]],
    [[1100, 1200, 1300, 1400, 1500]],
    [[0, 750, 1500, 2250, 3000]],
    [[1440, 1445, 1450, 1455, 1460]],
    [[10_000, 12_500, 15_000, 17_500, 20_000]],
    [[-250_000, -200_000, -150_000, 0]],
  ])('graduations entières « rondes » de Recharts (allowDecimals=false) : pas de doublon pour %j', (ticks) => {
    const labels = ticks.map(formatEURCompact);
    expect(new Set(labels).size).toBe(ticks.length);
  });
});
