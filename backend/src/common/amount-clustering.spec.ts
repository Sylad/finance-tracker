import { clusterByAmount } from './amount-clustering';

describe('clusterByAmount', () => {
  const amt = (x: { a: number }) => x.a;

  it('regroupe les montants à ±5 % de la moyenne courante', () => {
    const r = clusterByAmount([{ a: 100 }, { a: 104 }, { a: 200 }], amt);
    expect(r.map((b) => b.map(amt))).toEqual([[100, 104], [200]]);
  });

  it('travaille sur les montants absolus et trie par montant croissant', () => {
    const r = clusterByAmount([{ a: -200 }, { a: -100 }, { a: -102 }], amt);
    expect(r.map((b) => b.map(amt))).toEqual([[-100, -102], [-200]]);
  });

  it('sépare au-delà de la tolérance', () => {
    const r = clusterByAmount([{ a: 100 }, { a: 106 }], amt);
    expect(r).toHaveLength(2);
  });

  it('liste vide → aucun bucket', () => {
    expect(clusterByAmount([], amt)).toEqual([]);
  });
});
