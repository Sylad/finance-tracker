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
    accountNumber: z.string().nullable().optional(),
    rumNumber: z.string().nullable().optional(),
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
