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

export const CreditStatementOutputSchema = z
  .object({
    creditor: z.string(),
    creditType: z.enum(['revolving', 'classic']),
    currentBalance: z.number(),
    maxAmount: z.number().optional(),
    monthlyPayment: z.number(),
    endDate: z.string().nullable().optional(),
    taeg: z.number().nullable().optional(),
    statementDate: z.string(),
    startDate: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    rumNumber: z.string().nullable().optional(),
    installmentDetails: InstallmentDetailsSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.creditType === 'revolving' && (value.maxAmount == null || value.maxAmount <= 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxAmount'],
        message: 'maxAmount requis pour un crédit revolving',
      });
    }
  });

export type CreditStatementOutput = z.infer<typeof CreditStatementOutputSchema>;
