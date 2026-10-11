import { describe, expect, it } from 'vitest';
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
});
