/**
 * Liste UNIQUE des établissements de crédit (L44), partagée par
 * `auto-sync` (auto-création de Loan depuis les suggestions Claude) et
 * `credit-detection` (tri déterministe crédit / abonnement).
 *
 * Organismes de crédit français reconnus : membres ASF, acteurs BNPL,
 * filiales de banques spécialisées en crédit conso, financements auto.
 * Source : REGAFI ACPR + Association française des Sociétés Financières.
 * Noms en minuscules ; comparés sans accents.
 */
export const CREDIT_INSTITUTIONS: ReadonlySet<string> = new Set([
  // Filiales bancaires spécialisées crédit conso
  'cetelem', // BNP Paribas Personal Finance
  'cofinoga', // BNP
  'sofinco', // CA Consumer Finance
  'ca consumer finance',
  'creditas',
  'crédit agricole consumer finance',
  'franfinance', // Société Générale
  'societe generale insurance financial services',
  'floa', // BPCE
  'bpce financement',
  'banque postale consumer finance',
  'lbp consumer finance',
  'monabanq', // Crédit Mutuel
  // Indépendants / spécialistes
  'cofidis',
  'carrefour banque',
  'banque casino',
  'oney', // Auchan / BPCE
  'younited',
  'younited credit',
  // BNPL (Buy Now Pay Later)
  'klarna',
  'alma',
  'pledg',
  'paypal credit',
  // Constructeurs auto / financements spécifiques
  'cofica bail',
  'diac', // Renault Finance
  'rci banque', // Renault
  'psa bank', // Stellantis
  'volkswagen financial services',
  'bnp paribas personal finance',
  // Grandes banques, pour leur crédit immobilier (décision Sylvain L44) :
  // dans un libellé, comptent seulement avec un mot de crédit
  // (cf MORTGAGE_BANKS / CREDIT_WORDS).
  'la banque postale',
  'crédit agricole',
  'crédit mutuel',
  "caisse d'épargne",
  'banque populaire',
  'bnp paribas',
  'société générale',
  'lcl',
  'crédit lyonnais',
  'cic',
  'crédit du nord',
  'hsbc',
]);

/** Grandes banques de la liste : un libellé ne les désigne comme
 *  créancier qu'avec un mot de crédit (sinon cotisation, assurance…). */
export const MORTGAGE_BANKS: ReadonlySet<string> = new Set([
  'la banque postale',
  'crédit agricole',
  'crédit mutuel',
  "caisse d'épargne",
  'banque populaire',
  'bnp paribas',
  'société générale',
  'lcl',
  'crédit lyonnais',
  'cic',
  'crédit du nord',
  'hsbc',
]);

/** Sociétés de paiement fractionné pur (BNPL) : toute série chez elles
 *  est un paiement en N fois. */
export const BNPL_INSTITUTIONS: ReadonlySet<string> = new Set([
  'klarna',
  'alma',
  'pledg',
]);

/** Mots de crédit d'un libellé (comparés sans accents, en majuscules). */
export const CREDIT_WORDS =
  /\b(PRET|PRETS|MENSUALITE|MENSUALITES|CREDIT|EMPRUNT|ECHEANCE PRET)\b/;

/** « alma » n'est l'établissement que s'il est accolé à un indicateur de
 *  fractionné (« ALMA 3X », « 4 FOIS ALMA ») — sinon un magasin « Alma ». */
const ALMA_WITH_INDICATOR =
  / alma (\d{1,2} ?(x|fois)|x ?\d{1,2}) | (\d{1,2} ?(x|fois)) alma /;

/** Minuscules, sans accents, ponctuation → espace. */
export function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NORMALIZED = new Map<string, string>(
  [...CREDIT_INSTITUTIONS].map((name) => [normalizeLabel(name), name]),
);

/** Vrai si `creditor` est EXACTEMENT un établissement de la liste
 *  (casse, accents et ponctuation ignorés). */
export function isCreditInstitution(
  creditor: string | undefined | null,
): boolean {
  if (!creditor) return false;
  return NORMALIZED.has(normalizeLabel(creditor));
}

/** Libellé sans les noms d'établissements de la liste (« CREDIT » de
 *  « Crédit Mutuel » n'est pas un mot de crédit), en majuscules. */
export function labelWithoutInstitutions(description: string): string {
  let haystack = ` ${normalizeLabel(description)} `;
  const byLength = [...NORMALIZED.keys()].sort((a, b) => b.length - a.length);
  for (const normalized of byLength) {
    haystack = haystack.split(` ${normalized} `).join('  ');
  }
  return haystack.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Vrai si le libellé contient un mot de crédit hors noms d'établissements. */
export function hasCreditWord(description: string): boolean {
  return CREDIT_WORDS.test(labelWithoutInstitutions(description));
}

/** Établissements de la liste NOMMÉS dans le libellé (mots entiers), sans
 *  les conditions de `findCreditInstitution`, le plus long en premier. */
export function mentionedInstitutions(
  description: string | undefined | null,
): string[] {
  if (!description) return [];
  const haystack = ` ${normalizeLabel(description)} `;
  return [...NORMALIZED.entries()]
    .filter(([normalized]) => haystack.includes(` ${normalized} `))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([, name]) => name);
}

/** Établissement de la liste désigné par un libellé bancaire, par MOTS
 *  ENTIERS (« floa » ne matche pas « floating ») ; le nom le plus long
 *  gagne (« younited credit » plutôt que « younited »). Une grande banque
 *  exige un mot de crédit, « alma » un indicateur de fractionné accolé.
 *  null sinon. */
export function findCreditInstitution(
  description: string | undefined | null,
): string | null {
  if (!description) return null;
  const haystack = ` ${normalizeLabel(description)} `;
  for (const name of mentionedInstitutions(description)) {
    if (MORTGAGE_BANKS.has(name) && !hasCreditWord(description)) continue;
    if (name === 'alma' && !ALMA_WITH_INDICATOR.test(haystack)) continue;
    return name;
  }
  return null;
}
