/**
 * Miroir de la clé de marchand et du motif mémorisé du backend
 * (category-rules/merchant-dictionary.ts : merchantWords, merchantKey,
 * lookupMerchant, merchantRuleWords, merchantRule ; R1/R2/R4/R15/R18). Il sert à
 * afficher dans le sélecteur de catégorie EXACTEMENT les mots qui formeront le
 * motif de la règle « Mémoriser pour ce marchand ». Le backend reste la
 * référence ; un test de parité (backend, merchant-key-parity.spec.ts) exécute
 * les deux sur un même jeu de libellés et compare aussi les deux dictionnaires.
 */
const LEADING_PREFIXES = new Set([
  'CB', 'PAIEMENT', 'ACHAT', 'CARTE', 'PRELEVEMENT', 'PRELEVT', 'PRLV', 'VIR', 'VIREMENT',
]);

/** Mots d'exclusion des organismes de crédit/épargne homonymes (miroir de FINANCE_WORDS). */
const FINANCE_WORDS = ['BANQUE', 'BANK', 'FINANCE', 'FINANCEMENT', 'LIVRET', 'CREDIT', 'ASSURANCE', 'PRET'];

interface MirrorEntry {
  words: string[];
  unless?: string[];
}

/** Miroir des seuls mots et exclusions du dictionnaire (la catégorie n'y sert à rien). */
export const MERCHANT_WORDS_MIRROR: readonly MirrorEntry[] = [
  { words: ['CARREFOUR'], unless: FINANCE_WORDS },
  { words: ['LECLERC'] },
  { words: ['LIDL'] },
  { words: ['UBER', 'EATS'] },
  { words: ['SNCF'] },
  { words: ['TOTALENERGIES'] },
  { words: ['VINCI'] },
  { words: ['UBER'] },
  { words: ['NETFLIX'] },
  { words: ['FREE'], unless: ['DUTY'] },
  { words: ['ORANGE'], unless: FINANCE_WORDS },
];

/** Longueur minimale (lettres) d'un motif réduit à un seul mot (R15). */
export const MIN_SINGLE_WORD_PATTERN_LENGTH = 4;

export function merchantWords(label: string): string[] {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

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

/** Longueur minimale (lettres) d'un dernier mot tronqué pour compter comme mot d'exclusion (R4). */
export const MIN_TRUNCATED_WORD_LENGTH = 4;

function isExcluded(key: string[], unless: readonly string[] | undefined): boolean {
  if (!unless) return false;
  if (unless.some((w) => key.includes(w))) return true;
  const last = key[key.length - 1];
  return !!last && last.length >= MIN_TRUNCATED_WORD_LENGTH && unless.some((w) => w.startsWith(last));
}

function lookupMerchantWords(label: string): string[] | null {
  const key = merchantKey(label).split(' ').filter(Boolean);
  let best: MirrorEntry | null = null;
  for (const entry of MERCHANT_WORDS_MIRROR) {
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
  return best ? [...best.words] : null;
}

/** Mots du motif : ceux de l'enseigne reconnue, sinon la clé entière (R15). */
export function merchantRuleWords(label: string): string[] {
  return lookupMerchantWords(label) ?? merchantKey(label).split(' ').filter(Boolean);
}

export interface MerchantRule {
  words: string[];
  pattern: string | null;
  skipped?: 'merchant-key-empty' | 'pattern-too-short';
}

export function merchantRule(label: string): MerchantRule {
  const words = merchantRuleWords(label);
  if (words.length === 0) return { words, pattern: null, skipped: 'merchant-key-empty' };
  if (words.length === 1 && words[0].length < MIN_SINGLE_WORD_PATTERN_LENGTH) {
    return { words, pattern: null, skipped: 'pattern-too-short' };
  }
  return { words, pattern: `\\b${words.join('[^A-Za-z0-9]+')}\\b` };
}
