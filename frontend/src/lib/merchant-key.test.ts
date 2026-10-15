import { describe, expect, it } from 'vitest';
import { merchantKey, merchantRule, merchantRuleWords } from './merchant-key';

describe('merchantKey (miroir du backend, L75)', () => {
  it('R1 — « PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03 » donne la clé « CARREFOUR MARKET »', () => {
    expect(merchantKey('PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03')).toBe('CARREFOUR MARKET');
  });
  it('R2 — PAIEMENT et ACHAT seuls en tête sont retirés (« ACHAT VENTE AUTO » donne « VENTE AUTO »)', () => {
    expect(merchantKey('ACHAT VENTE AUTO')).toBe('VENTE AUTO');
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

describe('motif mémorisé, miroir du backend (L75, R15)', () => {
  it('R15 — enseigne reconnue : ses mots, bornés, même quand elle n\'est pas en tête', () => {
    expect(merchantRuleWords('RETRAIT DAB 12/03 CARREFOUR')).toEqual(['CARREFOUR']);
    expect(merchantRule('RETRAIT DAB 12/03 CARREFOUR').pattern).toBe('\\bCARREFOUR\\b');
    expect(merchantRule('CB STATION E.LECLERC').pattern).toBe('\\bLECLERC\\b');
  });

  it('R15 — marchand inconnu : la clé entière, chaque mot borné', () => {
    expect(merchantRuleWords('PAIEMENT CB RESTAURANT LE RECAMIER')).toEqual(['RESTAURANT', 'LE', 'RECAMIER']);
    expect(merchantRule('PAIEMENT CB RESTAURANT LE RECAMIER').pattern).toBe(
      '\\bRESTAURANT[^A-Za-z0-9]+LE[^A-Za-z0-9]+RECAMIER\\b',
    );
  });

  it('R15 — catégorie choisie contraire au dictionnaire : la clé entière (VINCI IMMOBILIER → Logement, BOULANGERIE ORANGE → Alimentation)', () => {
    expect(merchantRuleWords('PRLV VINCI IMMOBILIER LOYER', 'housing')).toEqual(['VINCI', 'IMMOBILIER', 'LOYER']);
    expect(merchantRule('PRLV VINCI IMMOBILIER LOYER', 'housing').pattern).toBe(
      '\\bVINCI[^A-Za-z0-9]+IMMOBILIER[^A-Za-z0-9]+LOYER\\b',
    );
    expect(merchantRuleWords('CB BOULANGERIE ORANGE', 'food')).toEqual(['BOULANGERIE', 'ORANGE']);
  });

  it('R15 — catégorie choisie = celle du dictionnaire : les mots de l\'enseigne', () => {
    expect(merchantRuleWords('PRLV VINCI IMMOBILIER LOYER', 'transport')).toEqual(['VINCI']);
    expect(merchantRuleWords('CB BOULANGERIE ORANGE', 'subscriptions')).toEqual(['ORANGE']);
  });

  it('R15 — un seul mot de moins de 4 lettres : pattern-too-short ; clé vide : merchant-key-empty', () => {
    expect(merchantRule('CB IKE 1234')).toEqual({ words: ['IKE'], pattern: null, skipped: 'pattern-too-short' });
    expect(merchantRule('CB 1234').skipped).toBe('merchant-key-empty');
  });
});
