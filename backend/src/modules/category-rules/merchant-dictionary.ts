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
export const LEADING_PREFIXES: ReadonlySet<string> = new Set([
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

/** Raisons pour lesquelles « Mémoriser pour ce marchand » ne crée pas de règle (R14, R15). */
export type MerchantRuleSkipped = 'merchant-key-empty' | 'pattern-too-short' | 'pattern-no-match';

export interface MerchantRule {
  /** Les mots qui formeront le motif, exactement ceux que le panneau affiche. */
  words: string[];
  /** Motif regex (flag i) ; null si `skipped`. */
  pattern: string | null;
  skipped?: Exclude<MerchantRuleSkipped, 'pattern-no-match'>;
}

/** Longueur minimale (lettres) d'un motif réduit à un seul mot (R15). */
export const MIN_SINGLE_WORD_PATTERN_LENGTH = 4;

/**
 * R15 : mots du motif mémorisé — ceux de l'enseigne reconnue par le dictionnaire
 * (R4) si le libellé en contient une, sinon la clé de marchand entière (R1).
 */
export function merchantRuleWords(label: string): string[] {
  const entry = lookupMerchant(label);
  return entry ? [...entry.words] : merchantKey(label).split(' ').filter(Boolean);
}

/**
 * R15 : règle mémorisée pour un libellé — chaque mot borné (\b), mots séparés par
 * [^A-Za-z0-9]+. Un motif d'un seul mot de moins de 4 lettres est refusé.
 */
export function merchantRule(label: string): MerchantRule {
  const words = merchantRuleWords(label);
  if (words.length === 0) return { words, pattern: null, skipped: 'merchant-key-empty' };
  if (words.length === 1 && words[0].length < MIN_SINGLE_WORD_PATTERN_LENGTH) {
    return { words, pattern: null, skipped: 'pattern-too-short' };
  }
  return { words, pattern: `\\b${words.join('[^A-Za-z0-9]+')}\\b` };
}

/** R15 : motif de la règle mémorisée ; null si la clé est vide ou le motif trop court. */
export function merchantPattern(label: string): string | null {
  return merchantRule(label).pattern;
}

/** Longueur minimale (lettres) d'un dernier mot tronqué pour compter comme mot d'exclusion (R4). */
export const MIN_TRUNCATED_WORD_LENGTH = 4;

/**
 * R4 : la clé contient un mot d'exclusion — en mot entier n'importe où, ou en
 * début de mot pour son DERNIER mot (libellé LBP tronqué : « BANQU » pour BANQUE),
 * à partir de 4 lettres.
 */
function isExcluded(key: string[], unless: readonly string[] | undefined): boolean {
  if (!unless) return false;
  if (unless.some((w) => key.includes(w))) return true;
  const last = key[key.length - 1];
  return !!last && last.length >= MIN_TRUNCATED_WORD_LENGTH && unless.some((w) => w.startsWith(last));
}

/** R4 : entrée dont les mots forment une suite contiguë de la clé ; la plus longue gagne. */
export function lookupMerchant(label: string): MerchantEntry | null {
  const key = merchantKey(label).split(' ').filter(Boolean);
  let best: MerchantEntry | null = null;
  for (const entry of MERCHANT_DICTIONARY) {
    if (best && entry.words.length <= best.words.length) continue;
    if (isExcluded(key, entry.unless)) continue;
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
 * réellement changées ; la sous-catégorie est vidée quand la catégorie change (R20).
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
    // R20 : la sous-catégorie de Claude décrivait l'ancienne catégorie, on la vide.
    return { ...tx, category: hit.category, subcategory: '' };
  });
  return { transactions: out, recategorized };
}
