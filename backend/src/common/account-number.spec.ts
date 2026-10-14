import { normalizeAccountNumber } from './account-number';

describe('normalizeAccountNumber', () => {
  it('retire séparateurs et passe en majuscules', () => {
    expect(normalizeAccountNumber('fr76 1234-5678.90ab')).toBe('FR761234567890AB');
  });
  it('tolère null, undefined et vide', () => {
    expect(normalizeAccountNumber(null)).toBe('');
    expect(normalizeAccountNumber(undefined)).toBe('');
    expect(normalizeAccountNumber('')).toBe('');
  });
});
