import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD attendue');

export const DeclarationInputSchema = z.object({
  type: z.enum(['income', 'loan', 'subscription', 'expense']),
  label: z.string().min(1, 'label requis'),
  amount: z.number(),
  periodicity: z.enum(['monthly', 'quarterly', 'yearly', 'one-shot']),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  category: z.string(),
  notes: z.string(),
  matchPattern: z.string(),
});

export type DeclarationInputDto = z.infer<typeof DeclarationInputSchema>;
