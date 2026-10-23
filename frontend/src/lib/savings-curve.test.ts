import { describe, expect, it } from 'vitest';
import { savingsCurve } from './savings-curve';

const hist = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
].map((month, i) => ({ month, balance: i < 3 ? 0 : 100 * (i - 2) }));

describe('savingsCurve (L119)', () => {
  it("R1 — les mois avant l'ouverture sont écartés de la courbe", () => {
    const c = savingsCurve(hist, { initialBalanceDate: '2026-02-10', movements: [] });
    expect(c?.points.map((p) => p.month)).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it("R2 — l'ouverture est le plus ancien de la date du solde initial et du premier mouvement", () => {
    const c = savingsCurve(hist, { initialBalanceDate: '2026-03-01', movements: [{ date: '2026-01-15' }] });
    expect(c?.points[0].month).toBe('2026-01');
  });

  it('R3 — début et fin donnent les montants et les mois des deux bouts', () => {
    const c = savingsCurve(hist, { initialBalanceDate: '2026-02-10', movements: [] });
    expect(c).toMatchObject({ startBalance: 100, endBalance: 300, startMonth: '2026-02', endMonth: '2026-04' });
  });

  it("R4 — un compte ouvert depuis 12 mois ou plus garde toute la fenêtre", () => {
    const c = savingsCurve(hist, { initialBalanceDate: '2020-01-01', movements: [] });
    expect(c?.points).toHaveLength(6);
  });

  it("R5 — moins de deux mois depuis l'ouverture : pas de courbe", () => {
    expect(savingsCurve(hist, { initialBalanceDate: '2026-04-02', movements: [] })).toBeNull();
    expect(savingsCurve([], { initialBalanceDate: '2026-04-02', movements: [] })).toBeNull();
  });
});
