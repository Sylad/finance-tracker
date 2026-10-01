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
]);

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NORMALIZED = new Map<string, string>(
  [...CREDIT_INSTITUTIONS].map((name) => [normalize(name), name]),
);

/** Vrai si `creditor` est EXACTEMENT un établissement de la liste
 *  (casse, accents et ponctuation ignorés). */
export function isCreditInstitution(creditor: string | undefined | null): boolean {
  if (!creditor) return false;
  return NORMALIZED.has(normalize(creditor));
}

/** Établissement de la liste cité dans un libellé bancaire, par MOTS
 *  ENTIERS (« floa » ne matche pas « floating ») ; le nom le plus long
 *  gagne (« younited credit » plutôt que « younited »). null sinon. */
export function findCreditInstitution(description: string | undefined | null): string | null {
  if (!description) return null;
  const haystack = ` ${normalize(description)} `;
  let best: string | null = null;
  let bestLength = 0;
  for (const [normalized, name] of NORMALIZED) {
    if (normalized.length > bestLength && haystack.includes(` ${normalized} `)) {
      best = name;
      bestLength = normalized.length;
    }
  }
  return best;
}
