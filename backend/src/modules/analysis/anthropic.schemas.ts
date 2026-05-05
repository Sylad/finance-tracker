import { z } from 'zod';

/**
 * Zod schemas mirroring the Anthropic tool `input_schema` JSON-schemas in
 * `anthropic.service.ts`. Used to validate the `tool_use.input` blocks
 * returned by Claude before we trust them — historically we cast directly
 * to `Record<string, unknown>` and read fields, which silently broke when
 * Claude omitted a required field.
 *
 * Keep these in sync with `EXTRACT_TRANSACTIONS_TOOL` and `ANALYZE_TOOL`.
 */

const transactionCategoryEnum = z.enum([
  'income',
  'housing',
  'transport',
  'food',
  'health',
  'entertainment',
  'subscriptions',
  'savings',
  'transfers',
  'taxes',
  'other',
]);

const externalAccountSchema = z.object({
  accountNumber: z.string(),
  accountType: z.enum(['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other']),
  balance: z.number(),
  label: z.string().optional(),
  asOfDate: z.string().optional(),
});

export const Phase1OutputSchema = z.object({
  bankName: z.string(),
  accountHolder: z.string(),
  currency: z.string(),
  openingBalance: z.number(),
  closingBalance: z.number(),
  transactions: z.array(
    z.object({
      date: z.string(),
      label: z.string(),
      amount: z.number(),
      category: transactionCategoryEnum,
      isRecurring: z.boolean(),
      targetAccountNumber: z.string().optional(),
    }),
  ),
  externalAccountBalances: z.array(externalAccountSchema).optional(),
});

export type Phase1Output = z.infer<typeof Phase1OutputSchema>;

export const Phase2OutputSchema = z.object({
  recurringCredits: z.array(
    z.object({
      description: z.string(),
      normalizedDescription: z.string(),
      monthlyAmount: z.number(),
      frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'irregular']),
      firstSeenDate: z.string(),
      lastSeenDate: z.string(),
      contractEndDate: z.string().nullable().optional(),
      endDateConfidence: z.enum(['high', 'medium', 'low', 'none']),
      category: z.enum(['salary', 'rental', 'pension', 'subsidy', 'investment', 'other']),
    }),
  ),
  analysisNarrative: z.string(),
  claudeHealthComment: z.string(),
  suggestedRecurringExpenses: z
    .array(
      z.object({
        label: z.string(),
        monthlyAmount: z.number(),
        occurrencesSeen: z.number(),
        firstSeenDate: z.string(),
        suggestedType: z.enum(['loan', 'subscription', 'utility']),
        matchPattern: z.string(),
        creditor: z.string().optional(),
      }),
    )
    .optional(),
});

export type Phase2Output = z.infer<typeof Phase2OutputSchema>;
