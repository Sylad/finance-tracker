import { Phase1OutputSchema, Phase2OutputSchema } from './anthropic.schemas';

describe('Anthropic Phase 1 / Phase 2 schemas', () => {
  describe('Phase1OutputSchema', () => {
    const valid = {
      bankName: 'LBP',
      accountHolder: 'Sylvain',
      currency: 'EUR',
      openingBalance: 1000,
      closingBalance: 900,
      transactions: [
        { date: '2026-03-05', label: 'COURSES', amount: -42, category: 'food', isRecurring: false },
      ],
    };

    it('accepts a minimal valid payload', () => {
      expect(() => Phase1OutputSchema.parse(valid)).not.toThrow();
    });

    it('rejects missing required field', () => {
      const { bankName: _omit, ...incomplete } = valid;
      expect(() => Phase1OutputSchema.parse(incomplete)).toThrow();
    });

    it('rejects unknown category enum value', () => {
      expect(() =>
        Phase1OutputSchema.parse({
          ...valid,
          transactions: [{ ...valid.transactions[0], category: 'banana' }],
        }),
      ).toThrow();
    });

    it('accepts targetAccountNumber when present', () => {
      const r = Phase1OutputSchema.parse({
        ...valid,
        transactions: [{ ...valid.transactions[0], targetAccountNumber: '12345678' }],
      });
      expect(r.transactions[0].targetAccountNumber).toBe('12345678');
    });

    it('accepts externalAccountBalances with valid accountType', () => {
      const r = Phase1OutputSchema.parse({
        ...valid,
        externalAccountBalances: [{ accountNumber: '1234', accountType: 'pel', balance: 500 }],
      });
      expect(r.externalAccountBalances).toHaveLength(1);
    });

    it('rejects externalAccountBalances with bad accountType', () => {
      expect(() =>
        Phase1OutputSchema.parse({
          ...valid,
          externalAccountBalances: [{ accountNumber: '1234', accountType: 'crypto', balance: 500 }],
        }),
      ).toThrow();
    });
  });

  describe('Phase2OutputSchema', () => {
    const valid = {
      recurringCredits: [
        {
          description: 'COFIDIS',
          normalizedDescription: 'cofidis',
          monthlyAmount: 80,
          frequency: 'monthly',
          firstSeenDate: '2025-01-15',
          lastSeenDate: '2026-03-15',
          contractEndDate: null,
          endDateConfidence: 'low',
          category: 'other',
        },
      ],
      scoreFactors: {
        estimatedSavingsRate: 0.15,
        discretionaryRatio: 0.3,
        recurringObligationRatio: 0.4,
        balanceTrend: 0.1,
        spendingVarianceScore: 0.7,
      },
      analysisNarrative: 'Ça va.',
      claudeHealthComment: 'Forces : épargne. Points : crédits.',
    };

    it('accepts a minimal valid payload', () => {
      expect(() => Phase2OutputSchema.parse(valid)).not.toThrow();
    });

    it('rejects bad frequency enum', () => {
      expect(() =>
        Phase2OutputSchema.parse({
          ...valid,
          recurringCredits: [{ ...valid.recurringCredits[0], frequency: 'fortnightly' }],
        }),
      ).toThrow();
    });

    it('accepts contractEndDate as null or omitted', () => {
      // contractEndDate is .nullable().optional() — both null and missing are allowed
      const r1 = Phase2OutputSchema.parse({
        ...valid,
        recurringCredits: [{ ...valid.recurringCredits[0], contractEndDate: null }],
      });
      expect(r1.recurringCredits[0].contractEndDate).toBeNull();
      const credit = { ...valid.recurringCredits[0] } as Record<string, unknown>;
      delete credit.contractEndDate;
      const r2 = Phase2OutputSchema.parse({ ...valid, recurringCredits: [credit] });
      expect(r2.recurringCredits[0].contractEndDate).toBeUndefined();
    });

    it('accepts optional suggestedRecurringExpenses', () => {
      const r = Phase2OutputSchema.parse({
        ...valid,
        suggestedRecurringExpenses: [
          {
            label: 'NETFLIX',
            monthlyAmount: 13.49,
            occurrencesSeen: 6,
            firstSeenDate: '2025-09-01',
            suggestedType: 'subscription',
            matchPattern: 'NETFLIX',
          },
        ],
      });
      expect(r.suggestedRecurringExpenses).toHaveLength(1);
    });
  });
});
