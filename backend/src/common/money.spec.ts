import { formatDecimalFr, round2 } from './money';

describe('round2', () => {
  it('arrondit au centime', () => {
    expect(round2(1.005 + 0.001)).toBe(1.01);
    expect(round2(12.344)).toBe(12.34);
    expect(round2(-3.456)).toBe(-3.46);
  });
  it('laisse les entiers et zéro intacts', () => {
    expect(round2(5)).toBe(5);
    expect(round2(0)).toBe(0);
  });
});

describe('formatDecimalFr', () => {
  it('L94 — deux décimales, virgule française', () => {
    expect(formatDecimalFr(240)).toBe('240,00');
    expect(formatDecimalFr(120.5)).toBe('120,50');
  });
});
