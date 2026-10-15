import {
  LEADING_PREFIXES,
  MERCHANT_DICTIONARY,
  MIN_TRUNCATED_WORD_LENGTH,
  merchantKey,
  merchantRule,
  merchantRuleWords,
  merchantWords,
} from './merchant-dictionary';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type * as Mirror from '../../../../frontend/src/lib/merchant-key';

/**
 * Le miroir vit dans le paquet frontend (« type »: « module »), que Jest ne sait
 * pas charger depuis le backend CommonJS : on transpile le fichier source (sans
 * import, donc autonome) en CommonJS et on l'exécute tel quel.
 */
function loadMirror(): typeof Mirror {
  const file = path.resolve(__dirname, '../../../../frontend/src/lib/merchant-key.ts');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as typeof Mirror };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}
const mirror = loadMirror();

/**
 * Parité backend / miroir frontend (L75, R1, R2, R15, R18) : le panneau
 * Catégoriser affiche les mots que calcule le miroir ; la règle créée est
 * calculée par le backend. Les deux doivent donner la même clé, les mêmes mots
 * et le même motif sur tout libellé, et porter le même dictionnaire.
 */
const LABELS = [
  'PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03',
  'RETRAIT DAB 12/03 CARREFOUR',
  'CB STATION E.LECLERC',
  'PAIEMENT CB RESTAURANT LE RECAMIER',
  'PAIEMENT CB RESTAURANT LES PHILOSOPHES',
  'VIR SEPA M DUPONT LOYER',
  'CB 1234',
  'CB IKE 1234',
  'CARTE X1234 LIDL',
  'CARTE X 1234 LIDL',
  'PRLV VIR NETFLIX',
  'PRELEVT NETFLIX',
  'VIREMENT LOYER APPARTEMENT',
  'PRLV SEPA CARREFOUR BANQUE 0123456',
  'PRLV CARREFOUR BANQU',
  'PRLV CARREFOUR BAN',
  'ORANGE LIVR',
  'CARREFOUR BANQU MARKET',
  'ACHAT VENTE AUTO',
  'PAIEMENT PSC BOULANGERIE',
  'CARREFOUR CITÉ',
  'BOULANGERIE CITÉ',
  'UBER EATS PARIS',
  'UBER 12 EATS',
  'UBER *TRIP',
  'UBER*TRIP',
  'PAYPAL *NETFLIX',
  'DUTY FREE CDG',
  'FREEDOM SPORT',
  'FREE MOBILE',
  'ORANGE SA',
  'PRELEVEMENT ORANGE BANK',
  'TOTAL ENERGIES',
  'TOTALENERGIES STATION',
  "L'ATELIER-DU/PAIN",
  'AMAZON.FR',
  'CB AMAZON.FR',
  'VINCI AUTOROUTES',
  'SNCF VOYAGES',
  '',
  '   ',
  '12/03 75015',
  'ÉCOLE ÀÇÛ',
];

describe('parité merchantKey / motif : backend et miroir frontend (L75)', () => {
  it.each(LABELS)('R1 — « %s » donne la même clé et les mêmes mots', (label) => {
    expect(mirror.merchantWords(label)).toEqual(merchantWords(label));
    expect(mirror.merchantKey(label)).toBe(merchantKey(label));
  });

  it.each(LABELS)('R15 — « %s » donne les mêmes mots de motif, le même motif et la même raison de refus', (label) => {
    expect(mirror.merchantRuleWords(label)).toEqual(merchantRuleWords(label));
    expect(mirror.merchantRule(label)).toEqual(merchantRule(label));
  });

  it('R4 — le dictionnaire du miroir porte les mêmes mots et exclusions que celui du backend, dans le même ordre', () => {
    expect(mirror.MERCHANT_WORDS_MIRROR.map((e) => ({ words: e.words, unless: e.unless ?? [] }))).toEqual(
      MERCHANT_DICTIONARY.map((e) => ({ words: e.words, unless: e.unless ?? [] })),
    );
  });

  it('R2 — la liste des préfixes bancaires retirés est la même, dans le même ordre', () => {
    expect([...mirror.LEADING_PREFIXES]).toEqual([...LEADING_PREFIXES]);
  });

  it('R4 — la longueur minimale d\'un mot d\'exclusion tronqué est la même', () => {
    expect(mirror.MIN_TRUNCATED_WORD_LENGTH).toBe(MIN_TRUNCATED_WORD_LENGTH);
  });

  it('R15 — la longueur minimale d\'un motif d\'un seul mot est la même', () => {
    expect(mirror.MIN_SINGLE_WORD_PATTERN_LENGTH).toBe(4);
    expect(merchantRule('CB IKE').skipped).toBe('pattern-too-short');
  });
});
