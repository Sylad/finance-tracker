import { pairNeutralTransactions } from './neutral-pairs';

const tx = (id: string, date: string, amount: number, description = 'X') => ({
  id,
  date,
  amount,
  description,
});

describe('pairNeutralTransactions', () => {
  it('apparie un débit et un crédit de même montant à ≤ 7 jours', () => {
    const pairs = pairNeutralTransactions([
      tx('d', '2026-03-01', -50),
      tx('c', '2026-03-08', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'd', inId: 'c', outAmount: 50 }]);
  });

  it('refuse un écart > 7 jours ou > 0,01 €', () => {
    expect(
      pairNeutralTransactions([tx('d', '2026-03-01', -50), tx('c', '2026-03-09', 50)]),
    ).toEqual([]);
    expect(
      pairNeutralTransactions([tx('d', '2026-03-01', -50), tx('c', '2026-03-02', 50.05)]),
    ).toEqual([]);
  });

  it('une transaction entre dans une seule paire, la plus proche gagne', () => {
    const pairs = pairNeutralTransactions([
      tx('d1', '2026-03-01', -50),
      tx('d2', '2026-03-05', -50),
      tx('c', '2026-03-06', 50),
    ]);
    expect(pairs.map((p) => p.outId)).toEqual(['d2']);
  });

  it('ignore les transactions exclues et les montants à 0 €', () => {
    const pairs = pairNeutralTransactions(
      [tx('d', '2026-03-01', -50), tx('c', '2026-03-02', 50), tx('z', '2026-03-02', 0)],
      new Set(['c']),
    );
    expect(pairs).toEqual([]);
  });

  it('écarte les libellés qui matchent un motif de crédit actif', () => {
    const txs = [
      tx('d', '2026-03-01', -50, 'PRLV SOFINCO'),
      tx('c', '2026-03-02', 50, 'VIR AMI'),
    ];
    expect(pairNeutralTransactions(txs, new Set(), ['sofinco'])).toEqual([]);
    expect(pairNeutralTransactions(txs, new Set(), ['autre'])).toHaveLength(1);
  });

  it('ignore un motif invalide sans planter', () => {
    const txs = [tx('d', '2026-03-01', -50), tx('c', '2026-03-02', 50)];
    expect(pairNeutralTransactions(txs, new Set(), ['(', 'zzz'])).toHaveLength(1);
  });
});
