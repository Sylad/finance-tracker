import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BudgetService } from './budget.service';

class FakeDataDir {
  constructor(public dir: string, public demo = false) {}
  getDataDir() { return this.dir; }
  isDemoMode() { return this.demo; }
}

describe('BudgetService', () => {
  let baseDir: string;
  let realDir: string;
  let demoDir: string;

  beforeEach(async () => {
    baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'budget-svc-'));
    realDir = baseDir;
    demoDir = path.join(baseDir, 'demo');
    await fs.promises.mkdir(demoDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(baseDir, { recursive: true, force: true });
  });

  it('returns {} when no budgets file exists (normal mode)', async () => {
    const svc = new BudgetService(new FakeDataDir(realDir, false) as any);
    expect(await svc.getBudgets()).toEqual({});
  });

  it('persists and reads budgets in normal mode (data/finance/budgets.json)', async () => {
    const svc = new BudgetService(new FakeDataDir(realDir, false) as any);
    await svc.saveBudgets({ food: 300, housing: 800 });
    const onDisk = JSON.parse(
      await fs.promises.readFile(path.join(realDir, 'budgets.json'), 'utf8'),
    );
    expect(onDisk).toEqual({ food: 300, housing: 800 });
    expect(await svc.getBudgets()).toEqual({ food: 300, housing: 800 });
  });

  it('filters out negative and non-numeric budget values', async () => {
    const svc = new BudgetService(new FakeDataDir(realDir, false) as any);
    const out = await svc.saveBudgets({
      food: 100,
      housing: -50,
      bogus: 'oops' as any,
      zero: 0,
    });
    expect(out).toEqual({ food: 100, zero: 0 });
  });

  it('writes to demo subdir when demo mode is active and never touches real budgets.json', async () => {
    // 1) seed real budgets (Sylvain's data) in baseDir
    const realBudgets = { food: 999, savings: 500 };
    await fs.promises.writeFile(
      path.join(realDir, 'budgets.json'),
      JSON.stringify(realBudgets),
      'utf8',
    );

    // 2) demo-mode service: getDataDir() returns demoDir (data/finance/demo)
    const svc = new BudgetService(new FakeDataDir(demoDir, true) as any);

    // demo starts empty (no demo budgets.json)
    expect(await svc.getBudgets()).toEqual({});

    // demo writes go to demo dir
    await svc.saveBudgets({ food: 1, housing: 2 });
    const demoOnDisk = JSON.parse(
      await fs.promises.readFile(path.join(demoDir, 'budgets.json'), 'utf8'),
    );
    expect(demoOnDisk).toEqual({ food: 1, housing: 2 });

    // CRITICAL: real budgets must remain untouched
    const realOnDisk = JSON.parse(
      await fs.promises.readFile(path.join(realDir, 'budgets.json'), 'utf8'),
    );
    expect(realOnDisk).toEqual(realBudgets);
  });

  it('demo mode reads from demo subdir, not real file', async () => {
    // real file has Sylvain's data
    await fs.promises.writeFile(
      path.join(realDir, 'budgets.json'),
      JSON.stringify({ food: 999 }),
      'utf8',
    );
    // demo file has demo data
    await fs.promises.writeFile(
      path.join(demoDir, 'budgets.json'),
      JSON.stringify({ food: 42 }),
      'utf8',
    );

    const svc = new BudgetService(new FakeDataDir(demoDir, true) as any);
    expect(await svc.getBudgets()).toEqual({ food: 42 });
  });
});
