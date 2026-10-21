import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { DemoSeedService } from './demo-seed.service';
import { RequestDataDirService } from './request-data-dir.service';
import { ImportLog } from '../../models/import-log.model';
import { LoansService } from '../loans/loans.service';
import { Loan } from '../../models/loan.model';
import { YearlySummary } from '../../models/yearly-summary.model';

/**
 * L62 — la démo doit alimenter « Historique des imports » (/upload) et
 * « Bilan annuel » (/yearly) : le seed n'écrivait ni import-logs.json ni bilan.
 */
describe('DemoSeedService — import-logs et bilan annuel (L62)', () => {
  // Les fixtures s'arrêtent en mars 2026 : au 15 avril, aucun recalage (L63).
  beforeAll(() => jest.useFakeTimers({ now: new Date('2026-04-15T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }));
  afterAll(() => jest.useRealTimers());

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

    it("complète le bilan 2025 d'une démo amorcée avant L65 (sans monthlyCashFlow)", async () => {
      const old = JSON.parse(fs.readFileSync(yearlyFile(), 'utf8'));
      delete old.monthlyCashFlow;
      fs.writeFileSync(yearlyFile(), JSON.stringify(old));

      service.onApplicationBootstrap();

      const y = JSON.parse(fs.readFileSync(yearlyFile(), 'utf8')) as YearlySummary;
      expect(y.monthlyCashFlow!.length).toBeGreaterThan(0);
    });

    it("L105 — complète le bilan d'une démo amorcée avant L104 (sans savingsDeposited) : le versé en épargne vient des relevés, pas d'une archive vide", async () => {
      const old = JSON.parse(fs.readFileSync(yearlyFile(), 'utf8'));
      const attendu = old.savingsDeposited;
      delete old.savingsDeposited;
      fs.writeFileSync(yearlyFile(), JSON.stringify(old));

      service.onApplicationBootstrap();

      const y = JSON.parse(fs.readFileSync(yearlyFile(), 'utf8')) as YearlySummary;
      expect(y.savingsDeposited).toBe(attendu);
      expect(y.savingsDeposited).toBeGreaterThan(0);
    });

    it('ne réécrit pas des fichiers déjà présents', async () => {
      fs.writeFileSync(logsFile(), '[]');
      fs.writeFileSync(yearlyFile(), '{"year":2025,"custom":true,"monthlyCashFlow":[],"savingsDeposited":0}');

      await service.seed();

      expect(fs.readFileSync(logsFile(), 'utf8')).toBe('[]');
      expect(fs.readFileSync(yearlyFile(), 'utf8')).toBe('{"year":2025,"custom":true,"monthlyCashFlow":[],"savingsDeposited":0}');
    });
  });
});

/** L63 — la démo est recalée sur la date du jour (dernier relevé = mois précédent). */
describe('DemoSeedService — recalage des dates (L63)', () => {
  let base: string;
  let demoDir: string;
  let service: DemoSeedService;
  const setNow = (iso: string) =>
    jest.useFakeTimers({ now: new Date(iso), doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
  const read = <T>(...p: string[]) => JSON.parse(fs.readFileSync(path.join(demoDir, ...p), 'utf8')) as T;
  const stmtIds = () => fs.readdirSync(path.join(demoDir, 'statements')).filter((f) => f.endsWith('.json')).sort();

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-seed-shift-'));
    demoDir = path.join(base, 'demo');
    const config = { get: (k: string) => (k === 'dataDir' ? base : undefined) } as unknown as ConfigService;
    service = new DemoSeedService(config, {} as RequestDataDirService);
  });
  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('au 11 octobre 2026, le dernier relevé est septembre 2026', async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    expect(stmtIds()).toEqual(['2026-04.json', '2026-05.json', '2026-06.json', '2026-07.json', '2026-08.json', '2026-09.json']);
    const loans = read<{ occurrencesDetected?: { statementId: string; date: string }[] }[]>('loans.json');
    const dates = loans.flatMap((l) => l.occurrencesDetected ?? []).map((o) => o.date).sort();
    expect(dates[dates.length - 1].slice(0, 7)).toBe('2026-09');
    expect(read<{ currentBalance: number; lastSyncedStatementId: string }[]>('savings-accounts.json')[0].lastSyncedStatementId).toBe('2026-09');
  });

  it('aucun crédit actif de la démo recalée n’est en « Trou » ni arrivé à terme', async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    const active = read<Loan[]>('loans.json').filter((l) => l.isActive);
    expect(active.length).toBeGreaterThan(0);
    for (const l of active) {
      expect([l.id, LoansService.getLoanHealth(l, '2026-10-11')]).not.toEqual([l.id, 'gap']);
      if (l.endDate) expect(l.endDate > '2026-10-11').toBe(true);
    }
  });

  it("garde un bilan de l'année révolue quand tous les relevés tiennent dans l'année", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    const y = read<YearlySummary>('yearly', '2025.json');
    expect(y.monthsCovered).toEqual([4, 5, 6, 7, 8, 9]);
    expect(fs.existsSync(path.join(demoDir, 'yearly', '2026.json'))).toBe(false);
  });

  it('à cheval sur deux années, le bilan vient des relevés révolus', async () => {
    setNow('2027-02-05T10:00:00Z');
    await service.seed();
    expect(stmtIds()[0]).toBe('2026-08.json');
    expect(read<YearlySummary>('yearly', '2026.json').monthsCovered).toEqual([8, 9, 10, 11, 12]);
    expect(fs.existsSync(path.join(demoDir, 'yearly', '2025.json'))).toBe(false);
  });

  it("recale au démarrage une démo amorcée un mois plus tôt, sans relevé orphelin", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    setNow('2026-11-02T10:00:00Z');
    service.onApplicationBootstrap();
    expect(stmtIds()).toEqual(['2026-05.json', '2026-06.json', '2026-07.json', '2026-08.json', '2026-09.json', '2026-10.json']);
  });

  it('recale une démo amorcée avant L63 (pas de fichier .shift)', async () => {
    setNow('2026-04-15T10:00:00Z');
    await service.seed();
    fs.rmSync(path.join(demoDir, '.shift'));
    setNow('2026-10-11T10:00:00Z');
    service.onApplicationBootstrap();
    expect(stmtIds()[5]).toBe('2026-09.json');
  });

  it('au recalage, les bilans annuels périmés sont retirés', async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    expect(fs.existsSync(path.join(demoDir, 'yearly', '2025.json'))).toBe(true);
    setNow('2027-02-05T10:00:00Z');
    service.onApplicationBootstrap();
    expect(fs.readdirSync(path.join(demoDir, 'yearly')).sort()).toEqual(['2026.json']);
  });

  it("aucun import n'est daté dans le futur (du 1er au 8 du mois)", async () => {
    setNow('2026-11-02T10:00:00Z');
    await service.seed();
    const now = new Date('2026-11-02T10:00:00Z').getTime();
    const logs = read<{ uploadedAt: string }[]>('import-logs.json');
    expect(logs.every((l) => new Date(l.uploadedAt).getTime() <= now)).toBe(true);
    const stmts = stmtIds().map((f) => read<{ uploadedAt: string }>('statements', f));
    expect(stmts.every((s) => new Date(s.uploadedAt).getTime() <= now)).toBe(true);
  });

  it("ne réécrit rien tant que le décalage est inchangé", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    fs.writeFileSync(path.join(demoDir, 'budgets.json'), '{"custom":1}');
    setNow('2026-10-30T10:00:00Z');
    service.onApplicationBootstrap();
    expect(fs.readFileSync(path.join(demoDir, 'budgets.json'), 'utf8')).toBe('{"custom":1}');
  });

  it("R1 — réécrit les données synthétiques quand les fixtures changent, décalage inchangé", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    fs.writeFileSync(path.join(demoDir, 'loans.json'), '[{"name":"CETELEM (240.00 €/mois)"}]');
    fs.writeFileSync(path.join(demoDir, '.fixtures'), 'empreinte-d-une-ancienne-version');
    service.onApplicationBootstrap();
    const loans = read<{ name: string }[]>('loans.json');
    expect(loans.some((l) => l.name.startsWith('CETELEM (240.00'))).toBe(false);
    expect(loans.length).toBeGreaterThan(1);
  });

  it("R2 — une démo amorcée avant L98 (pas de fichier .fixtures) est réécrite", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    fs.writeFileSync(path.join(demoDir, 'budgets.json'), '{"custom":1}');
    fs.rmSync(path.join(demoDir, '.fixtures'));
    service.onApplicationBootstrap();
    expect(fs.readFileSync(path.join(demoDir, 'budgets.json'), 'utf8')).not.toBe('{"custom":1}');
    expect(fs.existsSync(path.join(demoDir, '.fixtures'))).toBe(true);
  });

  it("R3 — l'empreinte inchangée ne réécrit rien (même décalage)", async () => {
    setNow('2026-10-11T10:00:00Z');
    await service.seed();
    fs.writeFileSync(path.join(demoDir, 'loans.json'), '{"custom":1}');
    service.onApplicationBootstrap();
    expect(fs.readFileSync(path.join(demoDir, 'loans.json'), 'utf8')).toBe('{"custom":1}');
  });
});
