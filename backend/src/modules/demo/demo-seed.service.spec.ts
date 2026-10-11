import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { DemoSeedService } from './demo-seed.service';
import { RequestDataDirService } from './request-data-dir.service';
import { ImportLog } from '../../models/import-log.model';
import { YearlySummary } from '../../models/yearly-summary.model';

/**
 * L62 — la démo doit alimenter « Historique des imports » (/upload) et
 * « Bilan annuel » (/yearly) : le seed n'écrivait ni import-logs.json ni bilan.
 */
describe('DemoSeedService — import-logs et bilan annuel (L62)', () => {
  let base: string;
  let demoDir: string;
  let service: DemoSeedService;

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-seed-spec-'));
    demoDir = path.join(base, 'demo');
    const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
    service = new DemoSeedService(config, {} as RequestDataDirService);
    await service.seed();
  });

  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('écrit import-logs.json depuis les fixtures', () => {
    const logs = JSON.parse(fs.readFileSync(path.join(demoDir, 'import-logs.json'), 'utf8')) as ImportLog[];
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.status === 'success')).toBe(true);
  });

  it('écrit le bilan 2025 calculé depuis les relevés 2025 des fixtures', () => {
    const y = JSON.parse(fs.readFileSync(path.join(demoDir, 'yearly', '2025.json'), 'utf8')) as YearlySummary;
    expect(y.year).toBe(2025);
    expect(y.monthsCovered).toEqual([10, 11, 12]);
    const stmts = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'demo-fixtures.json'), 'utf8'),
    ).statements as { year: number; totalCredits: number }[];
    const credits = stmts.filter((s) => s.year === 2025).reduce((a, s) => a + s.totalCredits, 0);
    expect(y.totalCredits).toBeCloseTo(credits, 2);
    expect(y.topCategories.length).toBeGreaterThan(0);
  });

  it("n'écrit pas de bilan pour l'année des relevés encore actifs", () => {
    expect(fs.existsSync(path.join(demoDir, 'yearly', '2026.json'))).toBe(false);
  });

  describe('démo déjà amorcée (sentinelle présente, PVC de prod)', () => {
    const logsFile = () => path.join(demoDir, 'import-logs.json');
    const yearlyFile = () => path.join(demoDir, 'yearly', '2025.json');

    it('rattrape import-logs.json et le bilan 2025 absents', async () => {
      fs.rmSync(logsFile());
      fs.rmSync(yearlyFile());

      const res = await service.seed();

      expect(res).toEqual({ seeded: false, reason: 'already-seeded' });
      expect(JSON.parse(fs.readFileSync(logsFile(), 'utf8'))).toHaveLength(4);
      expect((JSON.parse(fs.readFileSync(yearlyFile(), 'utf8')) as YearlySummary).year).toBe(2025);
    });

    it('rattrape au démarrage du module, sans appel à seed()', () => {
      fs.rmSync(logsFile());
      fs.rmSync(yearlyFile());

      service.onApplicationBootstrap();

      expect(JSON.parse(fs.readFileSync(logsFile(), 'utf8'))).toHaveLength(4);
      expect(fs.existsSync(yearlyFile())).toBe(true);
    });

    it("ne crée rien au démarrage si la démo n'a jamais été amorcée", () => {
      fs.rmSync(demoDir, { recursive: true, force: true });

      service.onApplicationBootstrap();

      expect(fs.existsSync(demoDir)).toBe(false);
    });

    it('ne réécrit pas des fichiers déjà présents', async () => {
      fs.writeFileSync(logsFile(), '[]');
      fs.writeFileSync(yearlyFile(), '{"year":2025,"custom":true}');

      await service.seed();

      expect(fs.readFileSync(logsFile(), 'utf8')).toBe('[]');
      expect(fs.readFileSync(yearlyFile(), 'utf8')).toBe('{"year":2025,"custom":true}');
    });
  });
});
