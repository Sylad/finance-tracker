import { z } from 'zod';

/**
 * Zod schema mirroring the Anthropic tool `extract_amortization_schedule`
 * defined in `amortization.service.ts`. Used to validate the `tool_use.input`
 * block returned by Claude before we trust it.
 *
 * Business rules :
 *  - schedule must contain ≥1 line (sinon le PDF n'a pas pu être parsé)
 *  - capitalRemaining doit globalement décroître (validation soft :
 *    on tolère un schedule désordonné, on tri côté service avant persist)
 *  - taeg optionnel : certains PDF n'affichent pas le TAEG explicitement
 */

export const AmortizationLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date doit être YYYY-MM-DD'),
  capitalRemaining: z.number().nonnegative(),
  capitalPaid: z.number().nonnegative(),
  interestPaid: z.number().nonnegative(),
});

export const AmortizationOutputSchema = z
  .object({
    creditor: z.string().min(1),
    initialPrincipal: z.number().positive(),
    monthlyPayment: z.number().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate doit être YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate doit être YYYY-MM-DD'),
    taeg: z.number().nullable().optional(),
    schedule: z.array(AmortizationLineSchema).min(1, 'schedule doit contenir au moins une ligne'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'endDate doit être postérieure à startDate',
      });
    }
  });

export type AmortizationOutput = z.infer<typeof AmortizationOutputSchema>;
export type AmortizationLine = z.infer<typeof AmortizationLineSchema>;
