import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonSync } from '../../common/atomic-write';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { buildYearlySummary } from '../storage/yearly-summary.builder';
import { capUploadDates, monthsToShift, shiftDemoFixtures } from './demo-date-shift';
import { RequestDataDirService } from './request-data-dir.service';

@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataDir: RequestDataDirService,
  ) {}

  /**
   * Fixtures recalées (L63) : leur dernier relevé devient le mois précédant la
   * date du jour. Le décalage retenu est renvoyé pour être mémorisé (`.shift`).
   */
  private loadFixtures(): { fixtures: Record<string, unknown>; shift: number } {
    const fixturePath = path.join(__dirname, 'demo-fixtures.json');
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
    const last = (raw.statements as MonthlyStatement[]).reduce((a, s) =>
      s.year * 12 + s.month > a.year * 12 + a.month ? s : a,
    );
    const shift = monthsToShift(last.year, last.month, new Date());
    return { fixtures: capUploadDates(shiftDemoFixtures(raw, shift), new Date()), shift };
  }

  private readShift(demoDir: string): number | null {
    try {
      return Number(fs.readFileSync(path.join(demoDir, '.shift'), 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Aucun client n'appelle `POST /demo/seed` sur une démo déjà amorcée : le
   * rattrapage L62 et le recalage des dates (L63) se jouent donc au démarrage
   * du backend.
   */
  onApplicationBootstrap(): void {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    if (!fs.existsSync(path.join(demoDir, '.seeded'))) return;
    try {
      this.refreshSeeded(demoDir);
    } catch (e) {
      this.logger.warn(`Rattrapage de la démo impossible : ${(e as Error).message}`);
    }
  }

  async seed(force = false): Promise<{ seeded: boolean; reason?: string }> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    const sentinel = path.join(demoDir, '.seeded');
    if (!force && fs.existsSync(sentinel)) {
      this.refreshSeeded(demoDir);
      return { seeded: false, reason: 'already-seeded' };
    }
    fs.mkdirSync(path.join(demoDir, 'statements', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'uploads'), { recursive: true });

    this.writeAll(demoDir, this.loadFixtures());
    this.logger.log(`Demo seeded at ${demoDir}`);
    return { seeded: true };
  }

  /**
   * Démo déjà amorcée : si le décalage des dates n'est plus celui du jour
   * (mois écoulé, ou démo antérieure à L63), les données synthétiques sont
   * réécrites ; sinon seuls les fichiers absents sont rattrapés (L62).
   */
  private refreshSeeded(demoDir: string): void {
    const loaded = this.loadFixtures();
    if (this.readShift(demoDir) === loaded.shift) {
      this.writeHistory(demoDir, loaded.fixtures, false);
      return;
    }
    for (const f of fs.readdirSync(path.join(demoDir, 'statements'))) {
      if (f.endsWith('.json')) fs.rmSync(path.join(demoDir, 'statements', f));
    }
    // Bilans de l'ancien décalage : writeHistory ne réécrit que ceux du nouveau.
    for (const f of fs.existsSync(path.join(demoDir, 'yearly')) ? fs.readdirSync(path.join(demoDir, 'yearly')) : []) {
      if (f.endsWith('.json')) fs.rmSync(path.join(demoDir, 'yearly', f));
    }
    this.writeAll(demoDir, loaded);
    this.logger.log(`Demo dates recalées de ${loaded.shift} mois à ${demoDir}`);
  }

  private writeAll(demoDir: string, loaded: { fixtures: Record<string, unknown>; shift: number }): void {
    const f = loaded.fixtures;
    for (const stmt of f.statements as { id: string }[]) {
      atomicWriteJsonSync(path.join(demoDir, 'statements', `${stmt.id}.json`), stmt);
    }
    this.writeHistory(demoDir, f, true);
    atomicWriteJsonSync(path.join(demoDir, 'savings-accounts.json'), f['savings-accounts']);
    atomicWriteJsonSync(path.join(demoDir, 'loans.json'), f.loans);
    atomicWriteJsonSync(path.join(demoDir, 'loan-suggestions.json'), f['loan-suggestions']);
    atomicWriteJsonSync(path.join(demoDir, 'declarations.json'), f.declarations);
    atomicWriteJsonSync(path.join(demoDir, 'budgets.json'), f.budgets);
    fs.writeFileSync(path.join(demoDir, '.shift'), String(loaded.shift));
    fs.writeFileSync(path.join(demoDir, '.seeded'), new Date().toISOString());
  }

  /**
   * Historique des imports et bilans des années révolues (comme l'archivage de
   * StorageService : sans eux /upload et /yearly restaient vides). `overwrite`
   * faux = n'écrit que ce qui manque.
   */
  private writeHistory(demoDir: string, f: Record<string, unknown>, overwrite: boolean): void {
    const write = (file: string, data: unknown) => {
      if (overwrite || !fs.existsSync(file)) atomicWriteJsonSync(file, data);
    };
    // Un bilan écrit avant L65 n'a pas monthlyCashFlow, et la démo n'a pas
    // d'archive d'où le recalculer (StorageService.withCashFlow) : on le réécrit.
    const writeYearly = (file: string, data: unknown) => {
      const stale = () => {
        try {
          return !('monthlyCashFlow' in JSON.parse(fs.readFileSync(file, 'utf8')));
        } catch {
          return true;
        }
      };
      if (overwrite || !fs.existsSync(file) || stale()) atomicWriteJsonSync(file, data);
    };
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    write(path.join(demoDir, 'import-logs.json'), f['import-logs']);
    const statements = f.statements as MonthlyStatement[];
    const lastYear = Math.max(...statements.map((s) => s.year));
    // Recalée, la démo peut tenir toute dans l'année en cours : le bilan de
    // l'année révolue est alors celui des mêmes relevés un an plus tôt.
    const past = statements.some((s) => s.year < lastYear)
      ? statements
      : (shiftDemoFixtures({ statements }, -12).statements as MonthlyStatement[]);
    for (const year of new Set(past.map((s) => s.year).filter((y) => y < lastYear))) {
      const summary = buildYearlySummary(
        year,
        past.filter((s) => s.year === year).sort((a, b) => a.month - b.month),
      );
      if (summary) writeYearly(path.join(demoDir, 'yearly', `${year}.json`), summary);
    }
  }

  async reset(): Promise<void> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    if (fs.existsSync(demoDir)) {
      fs.rmSync(demoDir, { recursive: true, force: true });
      this.logger.log(`Demo reset at ${demoDir}`);
    }
  }

  status(): { available: boolean; seeded: boolean; forced: boolean } {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const sentinel = path.join(this.config.get<string>('dataDir')!, 'demo', '.seeded');
    return { available, seeded: fs.existsSync(sentinel), forced: this.dataDir.isForced() };
  }
}
