import { describe, expect, it } from 'vitest';
import { merchantKey } from './merchant-key';

describe('merchantKey (miroir du backend, L75)', () => {
  it('R1 — « PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03 » donne la clé « CARREFOUR MARKET »', () => {
    expect(merchantKey('PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03')).toBe('CARREFOUR MARKET');
  });
  it('R2 — « CB 1234 » donne une clé vide', () => {
    expect(merchantKey('CB 1234')).toBe('');
  });
  it('R2 — « CARTE X1234 » et les préfixes de virement sont retirés en tête', () => {
    expect(merchantKey('CARTE X 1234 LIDL')).toBe('LIDL');
    expect(merchantKey('PRLV NETFLIX')).toBe('NETFLIX');
  });
  it('R18 — accents retirés et tout caractère hors A-Z/0-9 sépare les mots', () => {
    expect(merchantKey('CB AMAZON.FR')).toBe('AMAZON FR');
    expect(merchantKey('CARREFOUR CITÉ')).toBe('CARREFOUR CITE');
  });
});
