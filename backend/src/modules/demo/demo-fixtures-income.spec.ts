import * as fs from 'fs';
import * as path from 'path';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Declaration } from '../../models/declaration.model';

/**
 * L61 — la démo doit alimenter /income (crédits récurrents) et /forecast
 * (entrées + déclarations) : sans `recurringCredits` ni déclarations, /income
 * affichait « Importe au moins 2 relevés » et /forecast 0 € d'entrées.
 */
describe('demo-fixtures — revenus récurrents et déclarations (L61)', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf-8'),
  ) as { statements: MonthlyStatement[]; declarations: Declaration[] };

  it('chaque relevé déclare le salaire en crédit récurrent actif, cohérent avec sa transaction', () => {
    for (const s of fixtures.statements) {
      const salary = s.recurringCredits.find((c) => c.category === 'salary');
      expect(salary).toBeDefined();
      expect(salary!.isActive).toBe(true);
      expect(salary!.frequency).toBe('monthly');
      const tx = s.transactions.find((t) => t.subcategory === 'salary');
      expect(salary!.monthlyAmount).toBe(tx!.amount);
    }
  });

  it('le libellé du crédit récurrent ne ressemble pas à un déblocage de crédit', () => {
    for (const s of fixtures.statements) {
      for (const c of s.recurringCredits) {
        expect(`${c.description} ${c.normalizedDescription}`.toLowerCase()).not.toMatch(
          /floa|sofinco|cofidis|consumer finance|klarna|alma|oney/,
        );
      }
    }
  });

  it('contient des déclarations de dépenses synthétiques, sans revenu doublon du salaire', () => {
    expect(fixtures.declarations.length).toBeGreaterThanOrEqual(2);
    // Le salaire entre déjà dans /forecast par le crédit récurrent : une
    // déclaration de revenu le compterait deux fois.
    expect(fixtures.declarations.every((d) => d.type !== 'income')).toBe(true);
    for (const d of fixtures.declarations) {
      expect(d.id).toMatch(/^demo-/);
      expect(d.amount).toBeGreaterThan(0);
      expect(d.label).toBeTruthy();
    }
  });
});
