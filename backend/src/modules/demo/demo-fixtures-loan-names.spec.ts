import * as fs from 'fs';
import * as path from 'path';

/**
 * L95 — le nom d'un crédit démo est affiché tel quel sur /loans : un montant
 * y est écrit en fr-FR (virgule), jamais au point décimal (« 240.00 €/mois »).
 */
describe('demo-fixtures — noms des crédits (L95)', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'),
  ) as { loans: { name: string }[] };

  it('aucun nom de crédit ne porte un montant au point décimal', () => {
    const offending = fixtures.loans.map((l) => l.name).filter((n) => /\d\.\d{2}\s*€/.test(n));
    expect(offending).toEqual([]);
  });
});
