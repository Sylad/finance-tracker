import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { categoryLabelFr } from './category-label';

describe('categoryLabelFr', () => {
  it('traduit les catégories de transaction', () => {
    expect(categoryLabelFr('housing')).toBe('Logement');
    expect(categoryLabelFr('income')).toBe('Revenus');
  });

  it('traduit les sous-catégories anglaises, quelle que soit la casse', () => {
    expect(categoryLabelFr('SALARY')).toBe('Salaire');
    expect(categoryLabelFr('Loan')).toBe('Crédit');
    expect(categoryLabelFr('mortgage')).toBe('Prêt immobilier');
    expect(categoryLabelFr('rent')).toBe('Loyer');
  });

  it('traduit les catégories de déclaration et d’abonnement', () => {
    expect(categoryLabelFr('utilities')).toBe('Énergie / eau');
    expect(categoryLabelFr('utility')).toBe('Énergie / eau');
    expect(categoryLabelFr('insurance')).toBe('Assurance');
  });

  it('laisse intact un libellé inconnu (déjà en français ou saisi à la main)', () => {
    expect(categoryLabelFr('Streaming')).toBe('Streaming');
    expect(categoryLabelFr('Cantine')).toBe('Cantine');
  });

  it('traduit toute sous-catégorie des données de démo', () => {
    const raw = readFileSync(
      resolve(process.cwd(), '../backend/src/modules/demo/demo-fixtures.json'),
      'utf8',
    );
    const subs = new Set([...raw.matchAll(/"subcategory":\s*"([^"]+)"/g)].map((m) => m[1]));
    expect(subs.size).toBeGreaterThan(0);
    for (const sub of subs) {
      expect(categoryLabelFr(sub), sub).not.toBe(sub);
    }
    expect(categoryLabelFr('bonus')).toBe('Prime');
    expect(categoryLabelFr('travel')).toBe('Voyage');
    expect(categoryLabelFr('reimbursement')).toBe('Remboursement');
  });
});
