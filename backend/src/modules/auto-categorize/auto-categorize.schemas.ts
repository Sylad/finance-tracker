import { z } from 'zod';

/**
 * Zod schema mirroring the Anthropic tool `categorize_transactions` input_schema.
 * Used to validate the `tool_use.input` block returned by Claude before we trust
 * its content. Keep in sync with `CATEGORIZE_TOOL` in `auto-categorize.service.ts`.
 */
export const AutoCategorizeOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      transactionId: z.string(),
      suggestedCategory: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      proposedRulePattern: z.string().optional().nullable(),
    }),
  ),
});

export type AutoCategorizeOutput = z.infer<typeof AutoCategorizeOutputSchema>;
