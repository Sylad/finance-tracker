import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { categoryLabelFr, frenchHint, normalizeForSearch, transactionMatchesSearch } from './category-label';

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

describe('transactionMatchesSearch', () => {
  const tx = { description: 'PRLV FLOA', category: 'loans', subcategory: 'LOAN' };

  it('retrouve une ligne par le libellé français affiché', () => {
    expect(transactionMatchesSearch(tx, 'crédit')).toBe(true);
    expect(transactionMatchesSearch({ ...tx, subcategory: 'mortgage' }, 'prêt immobilier')).toBe(true);
  });

  it("ne trouve plus un mot anglais que l'écran n'affiche pas", () => {
    expect(transactionMatchesSearch({ ...tx, subcategory: 'mortgage' }, 'mortgage')).toBe(false);
  });

  it('cherche aussi dans la description et se rabat sur la catégorie sans sous-catégorie', () => {
    expect(transactionMatchesSearch(tx, 'floa')).toBe(true);
    expect(transactionMatchesSearch({ ...tx, category: 'housing', subcategory: '' }, 'logement')).toBe(true);
  });

  it("tolère l'absence d'accents et la casse", () => {
    expect(transactionMatchesSearch({ ...tx, subcategory: 'mortgage' }, 'pret immobilier')).toBe(true);
    expect(transactionMatchesSearch({ ...tx, subcategory: 'utilities' }, 'ENERGIE')).toBe(true);
    expect(transactionMatchesSearch({ ...tx, description: 'Prélèvement EDF' }, 'prelevement')).toBe(true);
  });

  it('compare la catégorie principale ET la sous-catégorie', () => {
    const t = { description: 'LOYER', category: 'housing', subcategory: 'rent' };
    expect(transactionMatchesSearch(t, 'logement')).toBe(true);
    expect(transactionMatchesSearch(t, 'loyer')).toBe(true);
    expect(transactionMatchesSearch({ ...t, category: 'transfers', subcategory: 'x' }, 'virements')).toBe(true);
  });
});

describe('normalizeForSearch', () => {
  it('retire accents et casse', () => {
    expect(normalizeForSearch('Énergie / Prêt')).toBe('energie / pret');
  });
});

describe('frenchHint', () => {
  it("donne le libellé français quand la saisie brute est un mot anglais connu", () => {
    expect(frenchHint('utilities')).toBe('Énergie / eau');
  });

  it("se tait si la saisie est vide, inconnue ou déjà en français", () => {
    expect(frenchHint('')).toBeNull();
    expect(frenchHint('  ')).toBeNull();
    expect(frenchHint('Cadeaux de Noël')).toBeNull();
    expect(frenchHint('Énergie / eau')).toBeNull();
  });
});
