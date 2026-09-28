import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeUsageService } from './claude-usage.service';

/**
 * L1 : claude-usage doit suivre l'isolation démo comme les autres modules.
 * Une requête en mode démo ne lit ni n'écrit le VRAI claude-shared.json
 * (partagé entre les 3 apps) ni le vrai claude-usage.json.
 */
describe('ClaudeUsageService — isolation démo', () => {
  let root: string;
  let dataDir: string;
  let sharedDir: string;
  let cwd: string;
  let demo: boolean;
  let service: ClaudeUsageService;
  const prevShared = process.env['SHARED_DATA_DIR'];

  const realShared = () => path.join(sharedDir, 'claude-shared.json');
  const demoShared = () => path.join(dataDir, 'demo', 'claude-shared.json');
  const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-'));
    dataDir = path.join(root, 'data');
    sharedDir = path.join(root, 'shared');
    cwd = path.join(root, 'backend');
    fs.mkdirSync(path.join(cwd, 'data'), { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    process.env['SHARED_DATA_DIR'] = sharedDir;
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);

    fs.writeFileSync(realShared(), JSON.stringify({
      balanceUsd: 42, balanceSetAt: '2026-09-01T00:00:00.000Z',
      totalConsumedUsdAtConfig: 0, totalConsumedUsd: 2,
    }));
    const month = new Date();
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    fs.writeFileSync(path.join(cwd, 'data', 'claude-usage.json'),
      JSON.stringify({ [key]: { inputTokens: 1000, outputTokens: 500, calls: 7 } }));

    demo = false;
    const requestDataDir = {
      isDemoMode: () => demo,
      getDataDir: () => (demo ? path.join(dataDir, 'demo') : dataDir),
    } as any;
    service = new ClaudeUsageService({ emit: jest.fn() } as any, requestDataDir);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    if (prevShared === undefined) delete process.env['SHARED_DATA_DIR'];
    else process.env['SHARED_DATA_DIR'] = prevShared;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('real instance: reads the real usage and shared balance (unchanged)', () => {
    const u = service.getUsage();
    expect(u.calls).toBe(7);
    expect(u.hasBalance).toBe(true);
    expect(u.configuredBalanceEur).toBeCloseTo(42 * 0.93, 2);
  });

  it('real instance: setBalance writes the real shared file (unchanged)', () => {
    service.setBalance(10);
    expect(readJson(realShared()).balanceUsd).toBe(10);
  });

  it('demo: getUsage exposes neither the real balance nor the real counters', () => {
    demo = true;
    const u = service.getUsage();
    expect(u.calls).toBe(0);
    expect(u.inputTokens).toBe(0);
    expect(u.hasBalance).toBe(false);
    expect(u.configuredBalanceEur).toBeNull();
  });

  it('demo: setBalance writes the demo copy, never the real shared file', () => {
    const before = fs.readFileSync(realShared(), 'utf-8');
    demo = true;
    service.setBalance(99);
    expect(fs.readFileSync(realShared(), 'utf-8')).toBe(before);
    expect(readJson(demoShared()).balanceUsd).toBe(99);
    expect(service.getUsage().configuredBalanceEur).toBeCloseTo(99 * 0.93, 2);
    demo = false;
    expect(service.getUsage().configuredBalanceEur).toBeCloseTo(42 * 0.93, 2);
  });

  it('demo: recordUsage leaves the real files untouched', () => {
    const realUsage = path.join(cwd, 'data', 'claude-usage.json');
    const beforeUsage = fs.readFileSync(realUsage, 'utf-8');
    const beforeShared = fs.readFileSync(realShared(), 'utf-8');
    demo = true;
    service.recordUsage(100, 50);
    expect(fs.readFileSync(realUsage, 'utf-8')).toBe(beforeUsage);
    expect(fs.readFileSync(realShared(), 'utf-8')).toBe(beforeShared);
    expect(service.getUsage().calls).toBe(1);
    demo = false;
    expect(service.getUsage().calls).toBe(7);
  });
});
