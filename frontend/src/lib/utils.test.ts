import { describe, expect, it } from 'vitest';
import {
  formatEUR,
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
