import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CategoryRulesService } from './category-rules.service';
import { Transaction } from '../../models/transaction.model';

class FakeDataDir {
  constructor(public dir: string) {}
  getDataDir() { return this.dir; }
  isDemoMode() { return false; }
}
class FakeBus { emit(_: string) {} }

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: over.id ?? 't1',
    date: '2026-03-01',
    description: over.description ?? '',
    normalizedDescription: over.normalizedDescription ?? '',
    amount: -10,
    currency: 'EUR',
    category: 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
    ...over,
  };
}

describe('CategoryRulesService', () => {
  let dir: string;
  let svc: CategoryRulesService;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cat-rules-'));
    svc = new CategoryRulesService(new FakeDataDir(dir) as any, new FakeBus() as any);
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('returns [] when no rules file exists', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates and persists a rule', async () => {
    const r = await svc.create({ pattern: 'NETFLIX', category: 'subscriptions' });
    expect(r.id).toBeTruthy();
    expect(r.flags).toBe('i');
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pattern).toBe('NETFLIX');
  });

  it('rejects an invalid regex', async () => {
    await expect(svc.create({ pattern: '(unclosed', category: 'other' })).rejects.toThrow(/Regex invalide/);
  });

  it('apply mutates matching transactions only', async () => {
    await svc.create({ pattern: 'NETFLIX', category: 'subscriptions', subcategory: 'streaming' });
    const txs = [
      tx({ id: '1', normalizedDescription: 'paiement netflix premium' }),
      tx({ id: '2', normalizedDescription: 'courses lidl' }),
    ];
    const out = await svc.apply(txs);
    expect(out[0].category).toBe('subscriptions');
    expect(out[0].subcategory).toBe('streaming');
    expect(out[1].category).toBe('other'); // unchanged
  });

  it('apply respects priority order (higher wins)', async () => {
    await svc.create({ pattern: 'AMAZON', category: 'entertainment', priority: 50 });
    await svc.create({ pattern: 'AMAZON', category: 'food', subcategory: 'fresh', priority: 200 });
    const out = await svc.apply([tx({ normalizedDescription: 'amazon fresh' })]);
    expect(out[0].category).toBe('food');
    expect(out[0].subcategory).toBe('fresh');
  });

  it('apply skips invalid regex without crashing', async () => {
    // Inject a corrupted rule directly (simulating a manual edit gone wrong)
    const corrupted = [
      { id: 'x', pattern: '(', flags: '', category: 'food', subcategory: '', priority: 100, createdAt: '', updatedAt: '' },
      { id: 'y', pattern: 'EDF', flags: 'i', category: 'housing', subcategory: '', priority: 100, createdAt: '', updatedAt: '' },
    ];
    await fs.promises.writeFile(path.join(dir, 'category-rules.json'), JSON.stringify(corrupted));
    const out = await svc.apply([tx({ normalizedDescription: 'prelevt edf' })]);
    expect(out[0].category).toBe('housing');
  });

  it('addUserCategory is idempotent (case-insensitive)', async () => {
    const a = await svc.addUserCategory('Bricolage');
    const b = await svc.addUserCategory('bricolage');
    expect(a.id).toBe(b.id);
  });

  it('getAvailableCategories merges builtin + user', async () => {
    await svc.addUserCategory('Cadeaux');
    const cats = await svc.getAvailableCategories();
    expect(cats).toContain('housing');
    expect(cats).toContain('Cadeaux');
  });

  it('delete removes a rule', async () => {
    const r = await svc.create({ pattern: 'X', category: 'other' });
    await svc.delete(r.id);
    expect(await svc.getAll()).toEqual([]);
  });

  it('delete throws on unknown id', async () => {
    await expect(svc.delete('nope')).rejects.toThrow(/introuvable/);
  });
});
