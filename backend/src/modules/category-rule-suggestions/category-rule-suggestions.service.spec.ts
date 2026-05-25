import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CategoryRuleSuggestionsService } from './category-rule-suggestions.service';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { ClaudeUsageService } from '../claude-usage/claude-usage.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

/**
 * Tests CRUD + transitions sans toucher l'appel Claude.
 * `generateFromOthers` n'est pas testé ici (mock client Anthropic = lourd).
 * Couvre : getAll/getPending, accept (crée la rule), reject/snooze/unsnooze.
 */
describe('CategoryRuleSuggestionsService', () => {
  let svc: CategoryRuleSuggestionsService;
  let rules: CategoryRulesService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cat-sugg-'));
    const mod = await Test.createTestingModule({
      providers: [
        CategoryRuleSuggestionsService,
        CategoryRulesService,
        { provide: ConfigService, useValue: { get: () => 'sk-test-fake' } },
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        { provide: StorageService, useValue: { getAllStatements: jest.fn().mockResolvedValue([]) } },
        { provide: ClaudeUsageService, useValue: { recordUsage: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(CategoryRuleSuggestionsService);
    rules = mod.get(CategoryRulesService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function seedSuggestion(overrides: any = {}) {
    const sugg = {
      id: 'sugg-1',
      pattern: 'NETFLIX',
      category: 'entertainment',
      exampleDescriptions: ['NETFLIX 10/05', 'NETFLIX 10/04'],
      occurrenceCount: 2,
      status: 'pending',
      createdAt: '2026-05-20T10:00:00Z',
      ...overrides,
    };
    fs.writeFileSync(
      path.join(tmpDir, 'category-rule-suggestions.json'),
      JSON.stringify([sugg]),
    );
    return sugg;
  }

  it('getAll returns empty array when file missing', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('getAll returns persisted suggestions', async () => {
    seedSuggestion();
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pattern).toBe('NETFLIX');
    expect(all[0].status).toBe('pending');
  });

  it('getPending excludes accepted and rejected, keeps snoozed', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'category-rule-suggestions.json'),
      JSON.stringify([
        { id: 'p', pattern: 'A', category: 'food', exampleDescriptions: [], occurrenceCount: 1, status: 'pending', createdAt: '' },
        { id: 's', pattern: 'B', category: 'food', exampleDescriptions: [], occurrenceCount: 1, status: 'snoozed', createdAt: '' },
        { id: 'a', pattern: 'C', category: 'food', exampleDescriptions: [], occurrenceCount: 1, status: 'accepted', createdAt: '' },
        { id: 'r', pattern: 'D', category: 'food', exampleDescriptions: [], occurrenceCount: 1, status: 'rejected', createdAt: '' },
      ]),
    );
    const pending = await svc.getPending();
    expect(pending.map((s) => s.id).sort()).toEqual(['p', 's']);
  });

  it('accept creates a CategoryRule + marks suggestion accepted + stamps acceptedAsRuleId', async () => {
    seedSuggestion({ id: 'sugg-1', pattern: 'NETFLIX', category: 'entertainment', subcategory: 'Streaming' });
    const { suggestion, ruleId } = await svc.accept('sugg-1');
    expect(suggestion.status).toBe('accepted');
    expect(suggestion.resolvedAt).toBeTruthy();
    expect(suggestion.acceptedAsRuleId).toBe(ruleId);

    // Rule effectively created
    const all = await rules.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pattern).toBe('NETFLIX');
    expect(all[0].category).toBe('entertainment');
    expect(all[0].subcategory).toBe('Streaming');
    expect(all[0].flags).toBe('i');
  });

  it('accept throws NotFoundException if id unknown', async () => {
    seedSuggestion();
    await expect(svc.accept('does-not-exist')).rejects.toThrow();
  });

  it('reject transitions status and stamps resolvedAt', async () => {
    seedSuggestion();
    const out = await svc.reject('sugg-1');
    expect(out.status).toBe('rejected');
    expect(out.resolvedAt).toBeTruthy();
  });

  it('snooze + unsnooze cycle preserves the suggestion as actionable', async () => {
    seedSuggestion();
    const snoozed = await svc.snooze('sugg-1');
    expect(snoozed.status).toBe('snoozed');
    expect(snoozed.resolvedAt).toBeTruthy();

    const restored = await svc.unsnooze('sugg-1');
    expect(restored.status).toBe('pending');
    expect(restored.resolvedAt).toBeUndefined();
  });

  it('generateFromOthers can use Ollama without calling Claude', async () => {
    const messagesCreate = jest.fn();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cat-sugg-ollama-'));
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          suggestions: [{
            pattern: 'NETFLIX',
            category: 'entertainment',
            subcategory: 'Streaming',
            exampleDescriptions: ['NETFLIX 10/05', 'NETFLIX 10/04'],
            occurrenceCount: 2,
            rationale: 'Service de streaming video.',
          }],
        }),
      }),
    } as any);

    const mod = await Test.createTestingModule({
      providers: [
        CategoryRuleSuggestionsService,
        CategoryRulesService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => ({
              anthropicApiKey: 'sk-test-fake',
              categoryRuleSuggestionsProvider: 'ollama',
              ollamaBaseUrl: 'http://ollama.local:11434',
              ollamaModel: 'qwen-test',
            })[key],
          },
        },
        { provide: RequestDataDirService, useValue: { getDataDir: () => tmpDir, isDemoMode: () => false, runWith: (_ctx: any, fn: any) => fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: StorageService,
          useValue: {
            getAllStatements: jest.fn().mockResolvedValue([{
              transactions: [
                { id: '1', date: '2026-05-01', description: 'NETFLIX 10/05', normalizedDescription: 'netflix', amount: -12, currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 1 },
                { id: '2', date: '2026-04-01', description: 'NETFLIX 10/04', normalizedDescription: 'netflix', amount: -12, currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 1 },
              ],
            }]),
          },
        },
        { provide: ClaudeUsageService, useValue: { recordUsage: jest.fn() } },
      ],
    })
      .overrideProvider(CategoryRuleSuggestionsService)
      .useFactory({
        factory: (config, dataDir, bus, storage, rulesService, usage) => {
          const service = new CategoryRuleSuggestionsService(config, dataDir, bus, storage, rulesService, usage);
          (service as any).client.messages.create = messagesCreate;
          return service;
        },
        inject: [ConfigService, RequestDataDirService, EventBusService, StorageService, CategoryRulesService, ClaudeUsageService],
      })
      .compile();

    const ollamaSvc = mod.get(CategoryRuleSuggestionsService);
    const result = await ollamaSvc.generateFromOthers();

    expect(result.created).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.local:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(messagesCreate).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});
