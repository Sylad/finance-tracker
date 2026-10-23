import * as fs from 'fs';
import * as path from 'path';

/**
 * L122 — dans la démo, le solde courant d'un compte d'épargne est la somme de
 * ses mouvements ; l'ajustement au relevé porte exactement l'écart, et sa note
 * ne contredit pas son montant.
 */
describe('demo-fixtures — épargne (L122)', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'),
  );
  const accounts: any[] = fixtures['savings-accounts'];

  it('R1 — le solde courant égale la somme des mouvements', () => {
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    for (const a of accounts) {
      const sum = a.movements.reduce((s: number, m: any) => s + m.amount, 0);
      expect({ id: a.id, sum }).toEqual({ id: a.id, sum: a.currentBalance });
    }
  });

  it('R2 — l’ajustement au relevé égale le solde du relevé moins le solde calculé annoncé dans sa note', () => {
    for (const a of accounts) {
      for (const m of a.movements.filter((x: any) => x.source === 'bank-extract')) {
        const before = a.movements
          .filter((x: any) => x !== m)
          .reduce((s: number, x: any) => s + x.amount, 0);
        expect(before + m.amount).toBe(a.currentBalance);
        const cited = /(\d+)\s*vs\s*(\d+)\s*calcul/.exec(m.note ?? '');
        if (cited) {
          expect(Number(cited[1])).toBe(a.currentBalance);
          expect(Number(cited[2])).toBe(before);
        }
      }
    }
  });
});
