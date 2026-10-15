import { Transaction, TransactionCategory } from '../../models/transaction.model';

/**
 * Dictionnaire de marchands livré avec le code (L75) : enseigne → catégorie
 * intégrée. Appliqué en local, avant la catégorie de Claude et après les
 * règles utilisateur. Pas de stockage : bumper la version à chaque changement
 * de contenu (elle n'est écrite que dans le log d'application).
 */
export const MERCHANT_DICTIONARY_VERSION = 1;

export interface MerchantEntry {
  /** Nom affiché dans le raisonnement des suggestions. */
  label: string;
  /** Mots (R18) qui doivent former une suite de mots entiers de la clé. */
  words: string[];
  category: TransactionCategory;
  /** Mots qui, présents n'importe où dans la clé, écartent l'entrée (homonymes). */
  unless?: string[];
}

/** Organismes de crédit/épargne et homonymes : jamais une dépense de l'enseigne. */
const FINANCE_WORDS = ['BANQUE', 'BANK', 'FINANCE', 'FINANCEMENT', 'LIVRET', 'CREDIT', 'ASSURANCE', 'PRET'];

export const MERCHANT_DICTIONARY: readonly MerchantEntry[] = [
  { label: 'Carrefour', words: ['CARREFOUR'], category: 'food', unless: FINANCE_WORDS },
  { label: 'Leclerc', words: ['LECLERC'], category: 'food' },
  { label: 'Lidl', words: ['LIDL'], category: 'food' },
  { label: 'Uber Eats', words: ['UBER', 'EATS'], category: 'food' },
  { label: 'SNCF', words: ['SNCF'], category: 'transport' },
  { label: 'TotalEnergies', words: ['TOTALENERGIES'], category: 'transport' },
  { label: 'Vinci', words: ['VINCI'], category: 'transport' },
  { label: 'Uber', words: ['UBER'], category: 'transport' },
  { label: 'Netflix', words: ['NETFLIX'], category: 'subscriptions' },
  { label: 'Free', words: ['FREE'], category: 'subscriptions', unless: ['DUTY'] },
  { label: 'Orange', words: ['ORANGE'], category: 'subscriptions', unless: FINANCE_WORDS },
];

/** Préfixes bancaires retirés en tête de libellé (R2). */
const LEADING_PREFIXES = new Set([
  'CB', 'PAIEMENT', 'ACHAT', 'CARTE', 'PRELEVEMENT', 'PRELEVT', 'PRLV', 'VIR', 'VIREMENT',
]);

/** R18 : majuscules, accents retirés, tout hors A-Z/0-9 sépare les mots. */
export function merchantWords(label: string): string[] {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * R1/R2 : clé de marchand d'un libellé brut — mots à chiffre (dates, numéros)
 * retirés, puis préfixes bancaires retirés en tête (« CARTE X » compris).
 * Calculée à la volée, jamais stockée.
 */
export function merchantKey(label: string): string {
  const words = merchantWords(label).filter((w) => !/\d/.test(w));
  let i = 0;
  while (i < words.length && LEADING_PREFIXES.has(words[i])) {
    const wasCard = words[i] === 'CARTE';
    i++;
    if (wasCard && words[i] === 'X') i++;
  }
  return words.slice(i).join(' ');
}

/** R15 : motif littéral des deux premiers mots de la clé ; null si la clé est vide. */
export function merchantPattern(label: string): string | null {
  const words = merchantKey(label).split(' ').filter(Boolean).slice(0, 2);
  return words.length > 0 ? words.join('[^A-Za-z0-9]+') : null;
}

/** R4 : entrée dont les mots forment une suite contiguë de la clé ; la plus longue gagne. */
export function lookupMerchant(label: string): MerchantEntry | null {
  const key = merchantKey(label).split(' ').filter(Boolean);
  let best: MerchantEntry | null = null;
  for (const entry of MERCHANT_DICTIONARY) {
    if (best && entry.words.length <= best.words.length) continue;
    if (entry.unless?.some((w) => key.includes(w))) continue;
    const n = entry.words.length;
    for (let start = 0; start + n <= key.length; start++) {
      if (entry.words.every((w, k) => key[start + k] === w)) {
        best = entry;
        break;
      }
    }
  }
  return best;
}

/** Libellé brut lu par les règles utilisateur (category-rules.service apply). */
export function rawLabel(tx: Pick<Transaction, 'normalizedDescription' | 'description'>): string {
  return tx.normalizedDescription || tx.description || '';
}

/**
 * R7/R8 : recatégorise les seuls débits que `skipIds` (règles utilisateur,
 * R19) n'a pas reconnus. Renvoie un nouveau tableau et le nombre de catégories
 * réellement changées. La sous-catégorie n'est pas touchée.
 */
export function applyMerchantDictionary(
  transactions: Transaction[],
  skipIds: ReadonlySet<string>,
): { transactions: Transaction[]; recategorized: number } {
  let recategorized = 0;
  const out = transactions.map((tx) => {
    if (skipIds.has(tx.id) || !(tx.amount < 0)) return tx;
    const hit = lookupMerchant(rawLabel(tx));
    if (!hit || hit.category === tx.category) return tx;
    recategorized++;
    return { ...tx, category: hit.category };
  });
  return { transactions: out, recategorized };
}
