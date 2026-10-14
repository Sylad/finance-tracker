import { monthKey } from './month-key';

describe('monthKey', () => {
  it('YYYY-MM-DD → YYYY-MM', () => {
    expect(monthKey('2026-03-15')).toBe('2026-03');
  });
  it('accepte déjà YYYY-MM', () => {
    expect(monthKey('2026-03')).toBe('2026-03');
  });
});
