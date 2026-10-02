import { describe, expect, it } from 'vitest';
import { formatNewsDay } from './news-data';

describe('formatNewsDay (L47)', () => {
  it('jour en toutes lettres, « 1er » pour le premier du mois', () => {
    expect(formatNewsDay('2026-10-01')).toBe('1er octobre 2026');
    expect(formatNewsDay('2026-09-29')).toBe('29 septembre 2026');
    expect(formatNewsDay('2026-09-11')).toBe('11 septembre 2026');
  });
});
