import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { AutoCategorizeService, chunk, sanitizeRulePattern } from './auto-categorize.service';
import { Transaction } from '../../models/transaction.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { CategoryRule } from '../../models/category-rule.model';

// ─── helpers ───────────────────────────────────────────────────────────────

function tx(partial: Partial<Transaction> & { id: string; description: string }): Transaction {
  return {
    id: partial.id,
    date: partial.date ?? '2026-03-15',
    description: partial.description,
    normalizedDescription: partial.normalizedDescription ?? partial.description,
    amount: partial.amount ?? -42,
    currency: 'EUR',
    category: partial.category ?? 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
  };
}

function statement(transactions: Transaction[]): MonthlyStatement {
  return {
    id: '2026-03',
    month: 3,
    year: 2026,
    uploadedAt: new Date().toISOString(),
    bankName: 'TEST',
    accountHolder: 'TEST',
    currency: 'EUR',
    openingBalance: 0,
    closingBalance: 0,
    totalCredits: 0,
    totalDebits: 0,
    transactions,
    healthScore: { total: 0, breakdown: { savingsRate: 0, expenseControl: 0, debtBurden: 0, cashFlowBalance: 0, irregularSpending: 0 }, trend: 'insufficient_data', claudeComment: '' },
    recurringCredits: [],
    analysisNarrative: '',
  };
}

interface ToolUseBlock { type: 'tool_use'; input: unknown }

function makeService(opts: {
  toolInputs: unknown[]; // one entry per Claude call
  isDemo?: boolean;
  stmt: MonthlyStatement;
  availableCategories?: string[];
  rejectAll?: boolean;
}) {
  const calls = { count: 0 };
  const fakeAnthropic = {
    messages: {
      create: jest.fn(async () => {
        if (opts.rejectAll) throw new Error('boom');
        const idx = calls.count++;
        const input = opts.toolInputs[idx] ?? { suggestions: [] };
        return {
          content: [{ type: 'tool_use', input } as ToolUseBlock],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'tool_use',
        };
      }),
    },
  };

  const fakeStorage = {
    saved: [] as MonthlyStatement[],
    getStatement: jest.fn(async (id: string) => (id === opts.stmt.id ? JSON.parse(JSON.stringify(opts.stmt)) : null)),
    saveStatement: jest.fn(async (s: MonthlyStatement) => { (fakeStorage.saved as MonthlyStatement[]).push(s); }),
    getAllStatements: jest.fn(async () => []),
  };

  const createdRules: CategoryRule[] = [];
  const fakeRules = {
    getAvailableCategories: jest.fn(async () =>
      opts.availableCategories ?? [
        'income', 'housing', 'transport', 'food', 'health',
        'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
      ],
    ),
    create: jest.fn(async (input: { pattern: string; flags?: string; category: string; subcategory?: string; priority?: number }) => {
      const rule: CategoryRule = {
        id: `rule-${createdRules.length}`,
        pattern: input.pattern,
        flags: input.flags ?? 'i',
        category: input.category,
        subcategory: input.subcategory ?? '',
        priority: input.priority ?? 100,
        createdAt: '',
        updatedAt: '',
      };
      createdRules.push(rule);
      return rule;
    }),
    apply: jest.fn(async (txs: Transaction[]) => txs),
  };

  const fakeUsage = { recordUsage: jest.fn() };
  const fakeDataDir = { isDemoMode: () => !!opts.isDemo, getDataDir: () => '/tmp', isForced: () => false, runWith: (_: any, fn: any) => fn() };

  // We bypass the real ConfigService — the service's constructor only calls
  // `config.get('anthropicApiKey')` and the SDK constructor accepts a fake key.
  const fakeConfig = { get: () => 'sk-test' };

  const svc = new AutoCategorizeService(
    fakeConfig as any,
    fakeStorage as any,
    fakeRules as any,
    fakeUsage as any,
    fakeDataDir as any,
  );
  // Inject the fake Anthropic client (the constructor created a real one, but
  // we replace it before any method runs).
  (svc as any).client = fakeAnthropic;

  return { svc, fakeAnthropic, fakeStorage, fakeRules, createdRules, fakeUsage };
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('AutoCategorizeService — preview()', () => {
  it('returns parsed Claude tool_use as suggestions, sorted by confidence', async () => {
    const txs = [
      tx({ id: 't1', description: 'CARREFOUR PARIS', normalizedDescription: 'CARREFOUR PARIS' }),
      tx({ id: 't2', description: 'PRELEVT COFIDIS 12345', normalizedDescription: 'PRELEVT COFIDIS' }),
    ];
    const { svc } = makeService({
      stmt: statement(txs),
      toolInputs: [
        {
          suggestions: [
            { transactionId: 't1', suggestedCategory: 'food', confidence: 0.9, reasoning: 'Supermarché', proposedRulePattern: 'CARREFOUR' },
            { transactionId: 't2', suggestedCategory: 'other', confidence: 0.6, reasoning: 'Crédit conso', proposedRulePattern: 'PRELEVT.*COFIDIS' },
          ],
        },
      ],
    });

    const result = await svc.preview('2026-03');

    // 'other' suggestions are filtered (no value), so we expect only 1 left
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].transactionId).toBe('t1');
    expect(result.suggestions[0].suggestedCategory).toBe('food');
    expect(result.suggestions[0].proposedRulePattern).toBe('CARREFOUR');
    expect(result.totalOther).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('drops invalid regex patterns and emits a warning', async () => {
    const txs = [tx({ id: 't1', description: 'NESPRESSO PARIS' })];
    const { svc } = makeService({
      stmt: statement(txs),
      toolInputs: [
        {
          suggestions: [
            { transactionId: 't1', suggestedCategory: 'subscriptions', confidence: 0.85, reasoning: 'Café', proposedRulePattern: '(unclosed' },
          ],
        },
      ],
    });

    const result = await svc.preview('2026-03');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].proposedRulePattern).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('refuses to run in demo mode', async () => {
    const txs = [tx({ id: 't1', description: 'X' })];
    const { svc, fakeAnthropic } = makeService({ stmt: statement(txs), toolInputs: [{ suggestions: [] }], isDemo: true });

    await expect(svc.preview('2026-03')).rejects.toThrow(ForbiddenException);
    // Make sure no Claude call was issued (token saved!)
    expect(fakeAnthropic.messages.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when statement does not exist', async () => {
    const { svc } = makeService({ stmt: statement([]), toolInputs: [] });
    await expect(svc.preview('1999-01')).rejects.toThrow(NotFoundException);
  });

  it('returns empty suggestions when no other transactions', async () => {
    const txs = [tx({ id: 't1', description: 'X', category: 'food' as any })];
    const { svc, fakeAnthropic } = makeService({ stmt: statement(txs), toolInputs: [] });
    const result = await svc.preview('2026-03');
    expect(result.suggestions).toEqual([]);
    expect(result.totalOther).toBe(0);
    expect(fakeAnthropic.messages.create).not.toHaveBeenCalled();
  });

  it('batches over 10 transactions into multiple Claude calls', async () => {
    const txs = Array.from({ length: 22 }, (_, i) => tx({ id: `t${i}`, description: `DESC ${i}` }));
    const { svc, fakeAnthropic } = makeService({
      stmt: statement(txs),
      // 3 batches: 10 + 10 + 2 — empty suggestions are fine for this assertion
      toolInputs: [{ suggestions: [] }, { suggestions: [] }, { suggestions: [] }],
    });
    await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(3);
  });
});

describe('AutoCategorizeService — apply()', () => {
  it('mutates transactions and creates rules when requested', async () => {
    const txs = [
      tx({ id: 't1', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR' }),
      tx({ id: 't2', description: 'NETFLIX', normalizedDescription: 'NETFLIX' }),
    ];
    const { svc, fakeStorage, fakeRules } = makeService({ stmt: statement(txs), toolInputs: [] });

    const result = await svc.apply('2026-03', [
      { transactionId: 't1', category: 'food', rulePattern: 'CARREFOUR' },
      { transactionId: 't2', category: 'subscriptions' }, // no rule
    ]);

    expect(result.applied).toBe(2);
    expect(result.rulesCreated).toBe(1);
    expect(fakeRules.create).toHaveBeenCalledTimes(1);
    expect(fakeStorage.saveStatement).toHaveBeenCalledTimes(1);

    // The saved statement must reflect the new categories.
    const saved = (fakeStorage.saveStatement as jest.Mock).mock.calls[0][0] as MonthlyStatement;
    expect(saved.transactions.find((t) => t.id === 't1')?.category).toBe('food');
    expect(saved.transactions.find((t) => t.id === 't2')?.category).toBe('subscriptions');
  });

  it('skips a rule whose regex does not match the transaction', async () => {
    const txs = [tx({ id: 't1', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR' })];
    const { svc, fakeRules } = makeService({ stmt: statement(txs), toolInputs: [] });

    const result = await svc.apply('2026-03', [
      { transactionId: 't1', category: 'food', rulePattern: 'TOTALLY_DIFFERENT' },
    ]);

    expect(result.applied).toBe(1);
    expect(result.rulesCreated).toBe(0);
    expect(fakeRules.create).not.toHaveBeenCalled();
  });

  it('rejects empty decisions array', async () => {
    const { svc } = makeService({ stmt: statement([]), toolInputs: [] });
    await expect(svc.apply('2026-03', [])).rejects.toThrow(BadRequestException);
  });

  it('refuses to run in demo mode', async () => {
    const txs = [tx({ id: 't1', description: 'X' })];
    const { svc, fakeStorage } = makeService({ stmt: statement(txs), toolInputs: [], isDemo: true });
    await expect(svc.apply('2026-03', [{ transactionId: 't1', category: 'food' }])).rejects.toThrow(ForbiddenException);
    expect(fakeStorage.saveStatement).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('chunk splits an array into fixed-size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('sanitizeRulePattern rejects too-broad patterns', () => {
    const t = tx({ id: 't', description: 'ANYTHING' });
    expect(sanitizeRulePattern('.*', t)).toBeNull();
    expect(sanitizeRulePattern('.+', t)).toBeNull();
  });

  it('sanitizeRulePattern rejects invalid regex', () => {
    const t = tx({ id: 't', description: 'CARREFOUR' });
    expect(sanitizeRulePattern('(unclosed', t)).toBeNull();
  });

  it('sanitizeRulePattern accepts a regex that matches the tx', () => {
    const t = tx({ id: 't', description: 'CARREFOUR PARIS', normalizedDescription: 'CARREFOUR PARIS' });
    expect(sanitizeRulePattern('CARREFOUR', t)).toBe('CARREFOUR');
  });

  it('sanitizeRulePattern rejects a regex that does not match the tx', () => {
    const t = tx({ id: 't', description: 'CARREFOUR' });
    expect(sanitizeRulePattern('NETFLIX', t)).toBeNull();
  });
});
