import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { StatementsController } from './statements.controller';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { Transaction } from '../../models/transaction.model';

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: '2026-03-01',
    description: '',
    normalizedDescription: '',
    amount: -20,
    currency: 'EUR',
    category: 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
    ...over,
  };
}

describe('StatementsController.patchTransactionCategory — memorizeMerchant (L75)', () => {
  let dir: string;
  let rules: CategoryRulesService;
  let ctrl: StatementsController;
  let statements: any[];
  let saved: number;
  const LABEL = 'PAIEMENT CB 1203 CARREFOUR MARKET 75015';

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'memo-'));
    statements = [
      { id: '2026-03', transactions: [tx({ id: 'a', description: LABEL, normalizedDescription: LABEL })] },
      { id: '2026-02', transactions: [tx({ id: 'z', description: 'CARREFOUR MARKET LYON', normalizedDescription: 'CARREFOUR MARKET LYON' })] },
    ];
    saved = 0;
    const storage = {
      getStatement: jest.fn(async (id: string) => statements.find((s) => s.id === id) ?? null),
      getAllStatements: jest.fn(async () => statements),
      saveStatement: jest.fn(async () => { saved++; }),
    };
    rules = new CategoryRulesService({ getDataDir: () => dir } as any, { emit: () => undefined } as any, storage as any);
    ctrl = new StatementsController(storage as any, {} as any, {} as any, {} as any, {} as any, rules, {} as any, {} as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  const patch = (body: any, txId = 'a', id = '2026-03') => ctrl.patchTransactionCategory(id, txId, body);

  it('R15 — « PAIEMENT CB 1203 CARREFOUR MARKET 75015 » crée le motif CARREFOUR[^A-Za-z0-9]+MARKET', async () => {
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.createdRule.pattern).toBe('CARREFOUR[^A-Za-z0-9]+MARKET');
    expect(res.createdRule).toMatchObject({ flags: 'i', category: 'food', subcategory: '', priority: 100 });
    expect(res.transaction.category).toBe('food');
    expect(res.replayed).toBe(0);
    expect(res.ruleSkipped).toBeUndefined();
  });

  it('R15 — la règle créée reconnaît ensuite le libellé brut et les autres relevés', async () => {
    await patch({ category: 'food', memorizeMerchant: true });
    const out = await rules.apply([statements[1].transactions[0]]);
    expect(out[0].category).toBe('food');
  });

  it('R13 — la règle créée porte la sous-catégorie du corps, vide si absente', async () => {
    const res: any = await patch({ category: 'food', subcategory: 'courses', memorizeMerchant: true });
    expect(res.createdRule.subcategory).toBe('courses');
  });

  it('R13 — deux mémorisations identiques du même marchand ne laissent qu\'une règle', async () => {
    const r1: any = await patch({ category: 'food', memorizeMerchant: true });
    const r2: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(await rules.getAll()).toHaveLength(1);
    expect(r2.createdRule.id).toBe(r1.createdRule.id);
  });

  it('R13 — une seconde mémorisation avec une autre catégorie crée une règle de priorité supérieure et laisse la première intacte', async () => {
    const r1: any = await patch({ category: 'food', memorizeMerchant: true });
    const r2: any = await patch({ category: 'health', memorizeMerchant: true });
    const all = await rules.getAll();
    expect(all).toHaveLength(2);
    expect(r2.createdRule.priority).toBe(101);
    expect(all.find((r) => r.id === r1.createdRule.id)).toEqual(r1.createdRule);
    const out = await rules.apply([statements[1].transactions[0]]);
    expect(out[0].category).toBe('health');
  });

  it('R13 — une règle utilisateur existante de priorité 200 sur le même libellé est dépassée (priorité 201) et reste inchangée, sous-catégorie comprise', async () => {
    const existing = await rules.create({ pattern: 'CARREFOUR', category: 'entertainment', subcategory: 'sorties', priority: 200 });
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.createdRule.priority).toBe(201);
    const all = await rules.getAll();
    expect(all.find((r) => r.id === existing.id)).toEqual(existing);
  });

  it('R13 — une règle gagnante qui donne déjà catégorie et sous-catégorie est réutilisée, rien n\'est écrit', async () => {
    const existing = await rules.create({ pattern: 'CARREFOUR', category: 'food', subcategory: 'courses', priority: 200 });
    const res: any = await patch({ category: 'food', subcategory: 'courses', memorizeMerchant: true });
    expect(res.createdRule).toEqual(existing);
    expect(await rules.getAll()).toHaveLength(1);
  });

  it('R13 — même catégorie mais sous-catégorie différente : nouvelle règle de priorité supérieure', async () => {
    await rules.create({ pattern: 'CARREFOUR', category: 'food', subcategory: 'courses', priority: 200 });
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.createdRule.priority).toBe(201);
  });

  it('R14 — libellé « CB 1234 » : catégorie appliquée, aucune règle, ruleSkipped merchant-key-empty', async () => {
    statements[0].transactions[0] = tx({ id: 'a', description: 'CB 1234', normalizedDescription: 'CB 1234' });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.transaction.category).toBe('food');
    expect(res.createdRule).toBeNull();
    expect(res.ruleSkipped).toBe('merchant-key-empty');
    expect(await rules.getAll()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Merchant rule not created for transaction a: merchant-key-empty');
  });

  it('R15 — un libellé dont le motif ne reconnaît pas le brut ne crée aucune règle (pattern-no-match)', async () => {
    statements[0].transactions[0] = tx({ id: 'a', description: 'CARREFOUR CITÉ', normalizedDescription: 'CARREFOUR CITÉ' });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.transaction.category).toBe('food');
    expect(res.createdRule).toBeNull();
    expect(res.ruleSkipped).toBe('pattern-no-match');
    expect(await rules.getAll()).toEqual([]);
  });

  it('R16 — sans memorizeMerchant, la réponse et la règle créée sont identiques à l\'existant', async () => {
    const res: any = await patch({ category: 'food', createRule: true, rulePattern: 'CARREFOUR' });
    expect(res).toEqual({ transaction: expect.objectContaining({ category: 'food' }), createdRule: expect.objectContaining({ pattern: 'CARREFOUR', priority: 100 }), replayed: 0 });
    expect(Object.keys(res).sort()).toEqual(['createdRule', 'replayed', 'transaction']);
    const plain: any = await patch({ category: 'health' });
    expect(plain.createdRule).toBeNull();
    expect(plain.ruleSkipped).toBeUndefined();
  });

  it('R16 — memorizeMerchant: "true" (chaîne) est traité comme absent : réponse existante, aucune règle', async () => {
    const res: any = await patch({ category: 'food', memorizeMerchant: 'true' });
    expect(res.createdRule).toBeNull();
    expect(res.replayed).toBe(0);
    expect(res.ruleSkipped).toBeUndefined();
    expect(await rules.getAll()).toEqual([]);
  });

  it('R16 — memorizeMerchant et createRule ensemble : une seule règle, celle de createRule', async () => {
    const res: any = await patch({ category: 'food', memorizeMerchant: true, createRule: true, rulePattern: 'MARKET' });
    expect(res.createdRule.pattern).toBe('MARKET');
    expect(await rules.getAll()).toHaveLength(1);
  });

  it('R16 — memorizeMerchant avec replayAll rejoue la règle sur les autres relevés', async () => {
    const res: any = await patch({ category: 'food', memorizeMerchant: true, replayAll: true });
    expect(res.replayed).toBe(1);
    expect(statements[1].transactions[0].category).toBe('food');
  });

  it('R16 — memorizeMerchant sans replayAll ne rejoue pas', async () => {
    const res: any = await patch({ category: 'food', memorizeMerchant: true });
    expect(res.replayed).toBe(0);
    expect(statements[1].transactions[0].category).toBe('other');
  });

  it('R17 — catégorie invalide avec memorizeMerchant : 400 et aucune règle créée', async () => {
    await expect(patch({ category: 'Pas Valide!', memorizeMerchant: true })).rejects.toThrow(BadRequestException);
    await expect(patch({ category: '', memorizeMerchant: true })).rejects.toThrow('category requis');
    expect(await rules.getAll()).toEqual([]);
    expect(saved).toBe(0);
  });

  it('R17 — transaction introuvable avec memorizeMerchant : 404 et aucune règle créée', async () => {
    await expect(patch({ category: 'food', memorizeMerchant: true }, 'nope')).rejects.toThrow(NotFoundException);
    await expect(patch({ category: 'food', memorizeMerchant: true }, 'a', '1999-01')).rejects.toThrow('Relevé 1999-01 introuvable');
    expect(await rules.getAll()).toEqual([]);
    expect(saved).toBe(0);
  });
});
