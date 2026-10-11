import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonSync } from '../../common/atomic-write';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { buildYearlySummary } from '../storage/yearly-summary.builder';
import { RequestDataDirService } from './request-data-dir.service';

@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataDir: RequestDataDirService,
  ) {}

  private loadFixtures(): Record<string, unknown> {
    const fixturePath = path.join(__dirname, 'demo-fixtures.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
  }

  /**
   * Aucun client n'appelle `POST /demo/seed` sur une démo déjà amorcée : le
   * rattrapage L62 se joue donc au démarrage du backend.
   */
  onApplicationBootstrap(): void {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    if (!fs.existsSync(path.join(demoDir, '.seeded'))) return;
    try {
      this.writeHistory(demoDir, this.loadFixtures(), false);
    } catch (e) {
      this.logger.warn(`Rattrapage de la démo impossible : ${(e as Error).message}`);
    }
  }

  async seed(force = false): Promise<{ seeded: boolean; reason?: string }> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    const sentinel = path.join(demoDir, '.seeded');
    if (!force && fs.existsSync(sentinel)) {
      // Démo amorcée avant L62 (PVC de prod) : rattrape les seuls fichiers absents.
      this.writeHistory(demoDir, this.loadFixtures(), false);
      return { seeded: false, reason: 'already-seeded' };
    }
    fs.mkdirSync(path.join(demoDir, 'statements', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'uploads'), { recursive: true });

    const f = this.loadFixtures();
    for (const stmt of f.statements as { id: string }[]) {
      atomicWriteJsonSync(path.join(demoDir, 'statements', `${stmt.id}.json`), stmt);
    }
    this.writeHistory(demoDir, f, true);
    atomicWriteJsonSync(path.join(demoDir, 'savings-accounts.json'), f['savings-accounts']);
    atomicWriteJsonSync(path.join(demoDir, 'loans.json'), f.loans);
    atomicWriteJsonSync(path.join(demoDir, 'loan-suggestions.json'), f['loan-suggestions']);
    atomicWriteJsonSync(path.join(demoDir, 'declarations.json'), f.declarations);
    atomicWriteJsonSync(path.join(demoDir, 'budgets.json'), f.budgets);
    fs.writeFileSync(sentinel, new Date().toISOString());
    this.logger.log(`Demo seeded at ${demoDir}`);
    return { seeded: true };
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
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    write(path.join(demoDir, 'import-logs.json'), f['import-logs']);
    const statements = f.statements as MonthlyStatement[];
    const lastYear = Math.max(...statements.map((s) => s.year));
    for (const year of new Set(statements.map((s) => s.year).filter((y) => y < lastYear))) {
      const summary = buildYearlySummary(
        year,
        statements.filter((s) => s.year === year).sort((a, b) => a.month - b.month),
      );
      if (summary) write(path.join(demoDir, 'yearly', `${year}.json`), summary);
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
