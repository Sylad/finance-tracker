import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { AutoCategorizeService, chunk, sanitizeRulePattern } from './auto-categorize.service';
import { Transaction } from '../../models/transaction.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { CategoryRule } from '../../models/category-rule.model';
import { expectAutoStrictCall } from '../analysis/forced-tool-spec';

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

interface ToolUseBlock { type: 'tool_use'; name: string; input: unknown }

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
          content: [{ type: 'tool_use', name: 'categorize_transactions', input } as ToolUseBlock],
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
    replayAll: jest.fn(async (_o?: unknown) => ({ processed: 2, updated: 1 })),
  };

  const fakeDataDir = { isDemoMode: () => !!opts.isDemo, getDataDir: () => '/tmp', isForced: () => false, runWith: (_: any, fn: any) => fn() };

  // We bypass the real ConfigService — the service's constructor only calls
  // `config.get('anthropicApiKey')` and the SDK constructor accepts a fake key.
  const fakeConfig = { get: () => 'sk-test' };

  const svc = new AutoCategorizeService(
    fakeConfig as any,
    fakeStorage as any,
    fakeRules as any,
    fakeDataDir as any,
  );
  // Inject the fake Anthropic client (the constructor created a real one, but
  // we replace it before any method runs).
  (svc as any).client = fakeAnthropic;

  return { svc, fakeAnthropic, fakeStorage, fakeRules, createdRules };
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('AutoCategorizeService — preview()', () => {
  it('returns parsed Claude tool_use as suggestions, sorted by confidence', async () => {
    const txs = [
      tx({ id: 't1', description: 'BOULANGERIE PARIS', normalizedDescription: 'BOULANGERIE PARIS' }),
      tx({ id: 't2', description: 'PRELEVT COFIDIS 12345', normalizedDescription: 'PRELEVT COFIDIS' }),
    ];
    const { svc } = makeService({
      stmt: statement(txs),
      toolInputs: [
        {
          suggestions: [
            { transactionId: 't1', suggestedCategory: 'food', confidence: 0.9, reasoning: 'Boulangerie', proposedRulePattern: 'BOULANGERIE' },
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
    expect(result.suggestions[0].proposedRulePattern).toBe('BOULANGERIE');
    expect(result.suggestions[0].source).toBe('claude');
    expect(result.totalOther).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('R11 — une suggestion issue de Claude porte source claude et les champs d\'origine inchangés', async () => {
    const { svc } = makeService({
      stmt: statement([tx({ id: 't1', description: 'BOULANGERIE PARIS', normalizedDescription: 'BOULANGERIE PARIS' })]),
      toolInputs: [
        { suggestions: [{ transactionId: 't1', suggestedCategory: 'food', confidence: 0.9, reasoning: 'Boulangerie', proposedRulePattern: 'BOULANGERIE' }] },
      ],
    });
    const [s] = (await svc.preview('2026-03')).suggestions;
    expect(s.source).toBe('claude');
    expect(s).toMatchObject({
      transactionId: 't1', suggestedCategory: 'food', confidence: 0.9,
      reasoning: 'Boulangerie', proposedRulePattern: 'BOULANGERIE',
    });
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

describe('AutoCategorizeService — preview() et dictionnaire de marchands (L75)', () => {
  const claudeSays = (id: string) => ({
    suggestions: [{ transactionId: id, suggestedCategory: 'health', confidence: 0.8, reasoning: 'Pharmacie', proposedRulePattern: 'PHARMACIE' }],
  });

  it('R10 — avec une transaction CARREFOUR et une inconnue, Claude ne reçoit que l\'inconnue', async () => {
    const txs = [
      tx({ id: 't1', description: 'PAIEMENT CB 1203 CARREFOUR MARKET 12/03', normalizedDescription: 'PAIEMENT CB 1203 CARREFOUR MARKET 12/03' }),
      tx({ id: 't2', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' }),
    ];
    const { svc, fakeAnthropic } = makeService({ stmt: statement(txs), toolInputs: [claudeSays('t2')] });
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify((fakeAnthropic.messages.create.mock.calls[0] as any[])[0].messages);
    expect(prompt).toContain('t2');
    expect(prompt).not.toContain('t1');
    expect(result.suggestions.map((s) => s.transactionId).sort()).toEqual(['t1', 't2']);
    expect(result.totalOther).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('R10 — avec uniquement des enseignes connues, le client Claude n\'est jamais appelé', async () => {
    const txs = [tx({ id: 't1', description: 'LIDL 1234', normalizedDescription: 'LIDL 1234' })];
    const { svc, fakeAnthropic } = makeService({ stmt: statement(txs), toolInputs: [] });
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).not.toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(1);
  });

  it('R10 — la suggestion du dictionnaire porte confidence 1 et source dictionary', async () => {
    const txs = [tx({ id: 't1', description: 'PAIEMENT CB 1203 CARREFOUR MARKET 12/03', normalizedDescription: 'PAIEMENT CB 1203 CARREFOUR MARKET 12/03' })];
    const { svc } = makeService({ stmt: statement(txs), toolInputs: [] });
    const [s] = (await svc.preview('2026-03')).suggestions;
    expect(s).toMatchObject({
      transactionId: 't1',
      suggestedCategory: 'food',
      confidence: 1,
      source: 'dictionary',
      reasoning: 'Marchand reconnu : Carrefour',
      proposedRulePattern: '\\bCARREFOUR\\b',
      currentCategory: 'other',
    });
  });

  it('R10 — le motif proposé est celui des mots de l\'enseigne, même quand elle n\'est pas en tête de la clé', async () => {
    const txs = [
      tx({ id: 't1', description: 'RETRAIT DAB 12/03 CARREFOUR', normalizedDescription: 'RETRAIT DAB 12/03 CARREFOUR' }),
      tx({ id: 't2', description: 'CB STATION E.LECLERC', normalizedDescription: 'CB STATION E.LECLERC' }),
    ];
    const { svc } = makeService({ stmt: statement(txs), toolInputs: [] });
    const out = (await svc.preview('2026-03')).suggestions;
    const byId = Object.fromEntries(out.map((s) => [s.transactionId, s.proposedRulePattern]));
    expect(byId).toEqual({ t1: '\\bCARREFOUR\\b', t2: '\\bLECLERC\\b' });
    expect(new RegExp(byId.t1 as string, 'i').test('RETRAIT DAB 03/04 BNP PARIBAS')).toBe(false);
    expect(new RegExp(byId.t2 as string, 'i').test('CB STATION ESSO')).toBe(false);
  });

  it('R10 — un motif qui ne reconnaît pas le libellé brut (mot à chiffre intercalé) donne proposedRulePattern null', async () => {
    const txs = [tx({ id: 't1', description: 'UBER 12 EATS', normalizedDescription: 'UBER 12 EATS' })];
    const { svc } = makeService({ stmt: statement(txs), toolInputs: [] });
    const [s] = (await svc.preview('2026-03')).suggestions;
    expect(s.source).toBe('dictionary');
    expect(s.proposedRulePattern).toBeNull();
  });

  it('R8 — un crédit CARREFOUR en other part à Claude, pas au dictionnaire', async () => {
    const txs = [tx({ id: 't1', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR', amount: 20 })];
    const { svc, fakeAnthropic } = makeService({ stmt: statement(txs), toolInputs: [{ suggestions: [] }] });
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(result.suggestions).toEqual([]);
  });

  it('R10 — les suggestions mêlent dictionary et claude, triées par confiance décroissante', async () => {
    const txs = [
      tx({ id: 't1', description: 'PHARMACIE', normalizedDescription: 'PHARMACIE' }),
      tx({ id: 't2', description: 'NETFLIX', normalizedDescription: 'NETFLIX' }),
    ];
    const { svc } = makeService({ stmt: statement(txs), toolInputs: [claudeSays('t1')] });
    const result = await svc.preview('2026-03');
    expect(result.suggestions.map((s) => [s.transactionId, s.source])).toEqual([['t2', 'dictionary'], ['t1', 'claude']]);
  });

  it('R12 — en mode démo, l\'aperçu répond 403 avec le message existant', async () => {
    const txs = [tx({ id: 't1', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR' })];
    const { svc } = makeService({ stmt: statement(txs), toolInputs: [], isDemo: true });
    await expect(svc.preview('2026-03')).rejects.toThrow(
      "L'auto-catégorisation Claude n'est pas disponible en mode démo (consomme des tokens API).",
    );
  });
});

describe('AutoCategorizeService — tool_choice auto + outil strict (L76)', () => {
  it('requête conforme (auto, strict, consigne, pas de temperature)', async () => {
    const { svc, fakeAnthropic } = makeService({
      stmt: statement([tx({ id: 't1', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' })]),
      toolInputs: [{ suggestions: [] }],
    });
    await svc.preview('2026-03');
    expectAutoStrictCall((fakeAnthropic.messages.create.mock.calls[0] as any[])[0], 'categorize_transactions');
  });

  it('aucun tool_use → un nouvel essai, puis erreur explicite (lot ignoré avec avertissement, pas de texte libre parsé)', async () => {
    const { svc, fakeAnthropic } = makeService({
      stmt: statement([tx({ id: 't1', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' })]),
      toolInputs: [],
    });
    (fakeAnthropic.messages.create as jest.Mock).mockImplementation(async () => ({
      content: [{ type: 'text', text: '{"suggestions":[{"transactionId":"t1"}]}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    }));
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(2);
    expect(result.suggestions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/n'a pas appelé l'outil categorize_transactions/);
  });

  it('budget de 8192 tokens (la réflexion compte dans max_tokens)', async () => {
    const { svc, fakeAnthropic } = makeService({
      stmt: statement([tx({ id: 't1', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' })]),
      toolInputs: [{ suggestions: [] }],
    });
    await svc.preview('2026-03');
    expect((fakeAnthropic.messages.create.mock.calls[0] as any[])[0].max_tokens).toBe(8192);
  });

  it('réponse tronquée (max_tokens) → lot ignoré avec avertissement, pas de liste partielle', async () => {
    const { svc, fakeAnthropic } = makeService({
      stmt: statement([tx({ id: 't1', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' })]),
      toolInputs: [],
    });
    (fakeAnthropic.messages.create as jest.Mock).mockImplementation(async () => ({
      content: [{ type: 'tool_use', name: 'categorize_transactions', input: { suggestions: [{ transactionId: 't1', suggestedCategory: 'health', confidence: 0.9, reasoning: 'x', proposedRulePattern: null }] } }],
      usage: { input_tokens: 1, output_tokens: 8192 },
      stop_reason: 'max_tokens',
    }));
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(1); // pas de relance
    expect(result.suggestions).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/tronquée \(max_tokens\)/);
  });

  it('refus → lot ignoré avec avertissement nommant le refus, sans relance', async () => {
    const { svc, fakeAnthropic } = makeService({
      stmt: statement([tx({ id: 't1', description: 'PHARMACIE DU CENTRE', normalizedDescription: 'PHARMACIE DU CENTRE' })]),
      toolInputs: [],
    });
    (fakeAnthropic.messages.create as jest.Mock).mockImplementation(async () => ({
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    }));
    const result = await svc.preview('2026-03');
    expect(fakeAnthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(result.warnings.join(' ')).toMatch(/refus.*catégorie cyber/);
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

  it('rejoue les règles UNE fois pour tout le lot, via CategoryRulesService.replayAll', async () => {
    const txs = [
      tx({ id: 't1', description: 'CARREFOUR', normalizedDescription: 'CARREFOUR' }),
      tx({ id: 't2', description: 'NETFLIX', normalizedDescription: 'NETFLIX' }),
    ];
    const { svc, fakeRules } = makeService({ stmt: statement(txs), toolInputs: [] });

    const result = await svc.apply('2026-03', [
      { transactionId: 't1', category: 'food', rulePattern: 'CARREFOUR', replayAll: true },
      { transactionId: 't2', category: 'subscriptions', rulePattern: 'NETFLIX', replayAll: true },
    ]);

    expect(fakeRules.replayAll).toHaveBeenCalledTimes(1);
    expect(fakeRules.replayAll).toHaveBeenCalledWith({ skipStatementId: expect.any(String) });
    expect(result.replayed).toBe(1);
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
