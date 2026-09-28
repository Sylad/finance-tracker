import { z } from 'zod';

/**
 * Zod schema mirroring the Anthropic tool `extract_credit_statement` defined
 * in `credit-statement.service.ts`. Used to validate the `tool_use.input`
 * block returned by Claude before we trust it (same pattern as
 * `anthropic.schemas.ts`).
 *
 * Business rules enforced via .superRefine() :
 *  - revolving requires a `maxAmount` (plafond)
 *  - classic credit recommends an `endDate`, but it stays optional because
 *    not every PDF surfaces it (Cofidis revolving statements never carry one).
 */

/**
 * Détails d'un paiement échelonné (kind='installment') extraits d'un contrat
 * 4XCB / 3X / N FOIS / FacilyPay. Présent uniquement quand le PDF est un
 * CONTRAT (pas un relevé mensuel). null sinon.
 */
export const InstallmentDetailsSchema = z.object({
  count: z.number().int().min(2).max(12),
  amount: z.number().positive(),  // montant uniforme (si variable, voir installments)
  installments: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date doit être YYYY-MM-DD'),
        amount: z.number().positive(),
      }),
    )
    .min(2),
  merchant: z.string().nullable().optional(),
  signatureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'signatureDate doit être YYYY-MM-DD').nullable().optional(),
  totalAmount: z.number().positive(),
  fees: z.number().nonnegative().nullable().optional(),
});

export type InstallmentDetails = z.infer<typeof InstallmentDetailsSchema>;

/**
 * Coerce les nombres potentiellement renvoyés en string par Claude
 * (constaté sur `maxAmount` des contrats 4XCB où Claude met "1000" au lieu
 * de 1000, ou simplement N/A car installment ≠ revolving). Pratique standard
 * pour les schemas Zod consommant du JSON LLM.
 */
const numberLike = z.preprocess(
  (v) => (typeof v === 'string' ? parseLocaleNumber(v) ?? v : v),
  z.number(),
);

/**
 * Lit un montant écrit à la française ("1.234,56", "3.000", "1 234,56 €")
 * ou à l'anglaise ("3,000.50"). Quand les deux séparateurs sont présents, le
 * dernier est la virgule décimale. Seul, un séparateur répété est un séparateur
 * de milliers ; un point unique suivi d'exactement 3 chiffres aussi ("3.000" =
 * trois mille — un montant ou un taux n'a jamais 3 décimales) ; une virgule
 * unique est décimale. Renvoie null si la chaîne n'est pas un nombre.
 */
export function parseLocaleNumber(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const thousands = lastDot > lastComma ? ',' : '.';
    s = s.split(thousands).join('').replace(',', '.');
  } else if (lastComma >= 0) {
    s = s.indexOf(',') !== lastComma ? s.split(',').join('') : s.replace(',', '.');
  } else if (lastDot >= 0 && (s.indexOf('.') !== lastDot || /^-?\d{1,3}\.\d{3}$/.test(s))) {
    s = s.split('.').join('');
  }
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

export const CreditStatementOutputSchema = z
  .object({
    // Optionnel (fail-open) : seul un type non-crédit EXPLICITE déclenche un
    // routage différent (plan d'amortissement) ou un rejet (relevé bancaire).
    documentType: z
      .enum(['credit_statement', 'amortization_plan', 'bank_statement', 'other'])
      .optional(),
    creditor: z.string(),
    creditType: z.enum(['revolving', 'classic']),
    currentBalance: numberLike,
    maxAmount: numberLike.nullable().optional(),
    monthlyPayment: numberLike,
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate doit être YYYY-MM-DD').nullable().optional(),
    taeg: numberLike.nullable().optional(),
    // Regex YYYY-MM-DD : une date FR (15/03/2026) passait en aval et cassait
    // les comparaisons lexicographiques (clé de dédup mensuelle, baseline des
    // tirages) — même exigence que InstallmentDetailsSchema/amortization.
    statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'statementDate doit être YYYY-MM-DD'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate doit être YYYY-MM-DD').nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    rumNumber: z.string().nullable().optional(),
    installmentDetails: InstallmentDetailsSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // maxAmount n'est requis QUE pour revolving SANS installmentDetails
    // (un contrat 4XCB est creditType='revolving' chez Cofidis mais doit être
    // traité comme installment, donc maxAmount n'a pas de sens).
    if (
      value.creditType === 'revolving'
      && !value.installmentDetails
      // Un document non-crédit (plan d'amortissement, relevé bancaire) est
      // routé/rejeté par le controller — ne pas exiger ses champs métier.
      && (value.documentType === undefined || value.documentType === 'credit_statement')
      && (value.maxAmount == null || value.maxAmount <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxAmount'],
        message: 'maxAmount requis pour un crédit revolving (sans installmentDetails)',
      });
    }
  });

export type CreditStatementOutput = z.infer<typeof CreditStatementOutputSchema>;
