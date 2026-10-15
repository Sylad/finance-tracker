import {
  MERCHANT_DICTIONARY,
  MERCHANT_DICTIONARY_VERSION,
  applyMerchantDictionary,
  lookupMerchant,
  merchantKey,
  merchantPattern,
  merchantWords,
} from './merchant-dictionary';
import { BUILTIN_CATEGORIES } from './category-rules.service';
import { Transaction } from '../../models/transaction.model';

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: '2026-03-01',
    description: '',
    normalizedDescription: '',
    amount: -20,
    currency: 'EUR',
    category: 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
    ...over,
  };
}

describe('merchantKey (R1, R2, R18)', () => {
  it('R1 — « PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03 » donne la clé « CARREFOUR MARKET »', () => {
    expect(merchantKey('PAIEMENT CB 1203 CARREFOUR MARKET 75015 12/03')).toBe('CARREFOUR MARKET');
  });

  it('R2 — chaque préfixe de la liste est retiré en tête de libellé', () => {
    for (const p of ['CB', 'PAIEMENT CB', 'ACHAT CB', 'CARTE', 'CARTE X1234', 'CARTE X 1234', 'PRELEVEMENT', 'PRELEVT', 'PRLV', 'VIR', 'VIREMENT']) {
      expect(merchantKey(`${p} BOULANGERIE DUPONT`)).toBe('BOULANGERIE DUPONT');
    }
  });

  it('R2 — « CB 1234 » donne une clé vide', () => {
    expect(merchantKey('CB 1234')).toBe('');
  });

  it('R2 — des préfixes enchaînés sont tous retirés, un préfixe en rang 3+ est conservé', () => {
    expect(merchantKey('PRLV VIR NETFLIX')).toBe('NETFLIX');
    expect(merchantKey('NETFLIX CB')).toBe('NETFLIX CB');
  });

  it('R18 — un libellé accentué « CARREFOUR CITÉ » est découpé sans l\'accent', () => {
    expect(merchantWords('CARREFOUR CITÉ')).toEqual(['CARREFOUR', 'CITE']);
  });

  it('R18 — séparateurs « . », « * », « - », « \' », « / »', () => {
    expect(merchantWords('E.LECLERC')).toEqual(['E', 'LECLERC']);
    expect(merchantWords('UBER *TRIP')).toEqual(['UBER', 'TRIP']);
    expect(merchantWords('UBER*TRIP')).toEqual(['UBER', 'TRIP']);
    expect(merchantWords("L'ATELIER-DU/PAIN")).toEqual(['L', 'ATELIER', 'DU', 'PAIN']);
  });
});

describe('lookupMerchant (R3, R4, R5, R18)', () => {
  const cases: Array<[string, string, string]> = [
    ['CARREFOUR MARKET', 'food', 'Carrefour'],
    ['LECLERC DRIVE', 'food', 'Leclerc'],
    ['LIDL 1234', 'food', 'Lidl'],
    ['SNCF VOYAGES', 'transport', 'SNCF'],
    ['TOTALENERGIES STATION', 'transport', 'TotalEnergies'],
    ['VINCI AUTOROUTES', 'transport', 'Vinci'],
    ['UBER TRIP', 'transport', 'Uber'],
    ['NETFLIX COM', 'subscriptions', 'Netflix'],
    ['FREE MOBILE', 'subscriptions', 'Free'],
    ['ORANGE SA', 'subscriptions', 'Orange'],
  ];
  it.each(cases)('R3 — « %s » est reconnu : %s', (label, category, brand) => {
    const hit = lookupMerchant(label);
    expect(hit?.category).toBe(category);
    expect(hit?.label).toBe(brand);
  });

  it('R3 — toutes les catégories du dictionnaire appartiennent aux catégories intégrées', () => {
    for (const e of MERCHANT_DICTIONARY) expect(BUILTIN_CATEGORIES).toContain(e.category);
  });

  it('R3 — le dictionnaire porte une version entière, 1 au départ', () => {
    expect(MERCHANT_DICTIONARY_VERSION).toBe(1);
  });

  it.each([
    'PRLV SEPA CARREFOUR BANQUE 0123456',
    'CARREFOUR BANQUE ECHEANCE',
    'PRELEVEMENT ORANGE BANK',
    'VIR SEPA LIVRET ORANGE BANK',
    'DUTY FREE CDG',
  ])('R4 — « %s » (organisme de crédit ou d\'épargne, homonyme) n\'est pas reconnu', (label) => {
    expect(lookupMerchant(label)).toBeNull();
  });

  it('R4 — « FREEDOM SPORT » n\'est pas reconnu comme Free', () => {
    expect(lookupMerchant('FREEDOM SPORT')).toBeNull();
  });

  it('R4 — « UBER EATS PARIS » est reconnu par l\'entrée UBER EATS, pas par UBER', () => {
    expect(lookupMerchant('UBER EATS PARIS')?.label).toBe('Uber Eats');
  });

  it('R5 — UBER EATS donne food', () => {
    expect(lookupMerchant('UBER EATS')?.category).toBe('food');
  });

  it('R4 — l\'enseigne est reconnue quelle que soit sa position', () => {
    expect(lookupMerchant('MAGASIN CARREFOUR')?.category).toBe('food');
  });

  it('R18 — « E.LECLERC PARIS » est reconnu comme Leclerc (food)', () => {
    expect(lookupMerchant('E.LECLERC PARIS')?.category).toBe('food');
  });

  it('R18 — « UBER *TRIP » et « UBER*TRIP » sont reconnus comme Uber (transport)', () => {
    expect(lookupMerchant('UBER *TRIP')?.category).toBe('transport');
    expect(lookupMerchant('UBER*TRIP')?.category).toBe('transport');
  });

  it('R18 — « PAYPAL *NETFLIX » est reconnu comme Netflix (subscriptions)', () => {
    expect(lookupMerchant('PAYPAL *NETFLIX')?.category).toBe('subscriptions');
  });

  it('R3 — « TOTAL » seul et « TOTAL ENERGIES » ne sont pas reconnus (choix documenté)', () => {
    expect(lookupMerchant('TOTAL STATION')).toBeNull();
    expect(lookupMerchant('TOTAL ENERGIES')).toBeNull();
  });
});

describe('merchantPattern (R15, R18)', () => {
  it('R15 — « PAIEMENT CB 1203 CARREFOUR MARKET 75015 » crée le motif CARREFOUR[^A-Za-z0-9]+MARKET', () => {
    expect(merchantPattern('PAIEMENT CB 1203 CARREFOUR MARKET 75015')).toBe('CARREFOUR[^A-Za-z0-9]+MARKET');
  });

  it('R15 — deux mots au plus sont retenus dans le motif', () => {
    expect(merchantPattern('BOULANGERIE DUPONT PARIS CENTRE')).toBe('BOULANGERIE[^A-Za-z0-9]+DUPONT');
  });

  it('R15 — un seul mot donne un motif littéral', () => {
    expect(merchantPattern('CB NETFLIX 1234')).toBe('NETFLIX');
  });

  it('R14 — une clé vide donne un motif null', () => {
    expect(merchantPattern('CB 1234')).toBeNull();
  });
});

describe('applyMerchantDictionary (R1, R7, R8)', () => {
  it('R8 — un débit « CARREFOUR » à -20 € passe en food', () => {
    const { transactions, recategorized } = applyMerchantDictionary(
      [tx({ id: 'a', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR', category: 'other' })],
      new Set(),
    );
    expect(transactions[0].category).toBe('food');
    expect(recategorized).toBe(1);
  });

  it('R8 — un crédit « CARREFOUR » à +20 € garde sa catégorie', () => {
    const { transactions, recategorized } = applyMerchantDictionary(
      [tx({ id: 'a', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR', amount: 20, category: 'income' })],
      new Set(),
    );
    expect(transactions[0].category).toBe('income');
    expect(recategorized).toBe(0);
  });

  it('R7 — une transaction reconnue par une règle utilisateur est ignorée', () => {
    const { transactions, recategorized } = applyMerchantDictionary(
      [tx({ id: 'a', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR', category: 'other' })],
      new Set(['a']),
    );
    expect(transactions[0].category).toBe('other');
    expect(recategorized).toBe(0);
  });

  it('R4 — une enseigne inconnue laisse la catégorie de Claude intacte', () => {
    const { transactions } = applyMerchantDictionary(
      [tx({ id: 'a', description: 'BOULANGERIE', normalizedDescription: 'BOULANGERIE', category: 'health' })],
      new Set(),
    );
    expect(transactions[0].category).toBe('health');
  });

  it('R6 — le compte ne compte que les catégories réellement changées', () => {
    const { recategorized } = applyMerchantDictionary(
      [
        tx({ id: 'a', description: 'LIDL', normalizedDescription: 'LIDL', category: 'food' }),
        tx({ id: 'b', description: 'LIDL', normalizedDescription: 'LIDL', category: 'other' }),
      ],
      new Set(),
    );
    expect(recategorized).toBe(1);
  });

  it('R1 — description et normalizedDescription sont identiques avant et après le passage', () => {
    const t = tx({ id: 'a', description: 'PAIEMENT CB 1203 CARREFOUR MARKET', normalizedDescription: 'paiement cb carrefour market' });
    const { transactions } = applyMerchantDictionary([t], new Set());
    expect(transactions[0].description).toBe('PAIEMENT CB 1203 CARREFOUR MARKET');
    expect(transactions[0].normalizedDescription).toBe('paiement cb carrefour market');
  });
});
