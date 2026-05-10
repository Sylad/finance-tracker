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
  (v) => {
    if (typeof v === 'string') {
      const cleaned = v.replace(/[^\d.,-]/g, '').replace(',', '.');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  },
  z.number(),
);

export const CreditStatementOutputSchema = z
  .object({
    creditor: z.string(),
    creditType: z.enum(['revolving', 'classic']),
    currentBalance: numberLike,
    maxAmount: numberLike.nullable().optional(),
    monthlyPayment: numberLike,
    endDate: z.string().nullable().optional(),
    taeg: numberLike.nullable().optional(),
    statementDate: z.string(),
    startDate: z.string().nullable().optional(),
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
