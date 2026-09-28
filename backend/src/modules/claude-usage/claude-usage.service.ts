/**
 * ⚠ DUPLICATED across 3 backends (finance-tracker, warhammer40k, ol-companion).
 *
 * The 3 apps share `claude-shared.json` on the NAS to track a single Claude
 * balance across them. The 3 services are nearly identical by design — only
 * the import-extension convention differs (warhammer40k uses `.js` for
 * NodeNext, the other two CommonJS).
 *
 * Convention : finance-tracker is the **canonical source**. When you change
 * this file, sync the other two before pushing :
 *   - warhammer40k/backend/src/modules/claude-usage/claude-usage.service.ts
 *   - ol-companion/backend/src/modules/claude-usage/claude-usage.service.ts
 *
 * Real mutualization (npm workspace, path-mapped shared package) was assessed
 * and deferred : the cost of restructuring 3 Dockerfiles + 3 tsconfigs was
 * judged too high vs. the rate of drift on this 130-line file.
 *
 * ⚠ Exception finance-tracker (L1, 2026-09-28) : l'isolation démo
 * (RequestDataDirService) n'existe que dans cette app sous cette forme. En mode
 * démo, les compteurs et le solde vivent dans `<DATA_DIR>/demo/` (copie démo) :
 * une requête démo ne lit ni n'écrit jamais le vrai `claude-shared.json` ni le
 * vrai `claude-usage.json`. Hors démo, chemins et comportement inchangés.
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonSync } from '../../common/atomic-write';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

export interface UsageResponse {
  month: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedCostEur: number;
  budgetEur: number;
  percent: number;
  hasBalance: boolean;
  estimatedRemainingEur: number | null;
  configuredBalanceEur: number | null;
  remainingPercent: number | null;
}

interface SharedData {
  balanceUsd: number | null;
  balanceSetAt: string | null;
  totalConsumedUsdAtConfig: number;
  totalConsumedUsd: number;
}

const BUDGET_EUR = 10;
const INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;
const USD_TO_EUR = 0.93;
const SHARED_FILENAME = 'claude-shared.json';
const USAGE_FILENAME = 'claude-usage.json';
const EMPTY_SHARED: SharedData = { balanceUsd: null, balanceSetAt: null, totalConsumedUsdAtConfig: 0, totalConsumedUsd: 0 };
type MonthlyUsage = Record<string, { inputTokens: number; outputTokens: number; calls: number }>;

// Sommeil synchrone sans spin CPU (Atomics.wait est autorisé sur le main
// thread Node) ; fallback busy-wait si indisponible.
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin court */ }
  }
}

@Injectable()
export class ClaudeUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaudeUsageService.name);
  // Chemins RÉELS (instance aux vraies données) — inchangés par L1.
  private readonly filePath = path.resolve(process.cwd(), 'data', USAGE_FILENAME);
  private readonly sharedFile = path.join(
    process.env['SHARED_DATA_DIR'] ?? path.resolve(process.cwd(), 'data', 'shared'),
    SHARED_FILENAME,
  );
  private readonly sharedDir = path.dirname(this.sharedFile);
  private data: MonthlyUsage = {};
  private watcher: fs.FSWatcher | null = null;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly bus: EventBusService,
    private readonly requestDataDir: RequestDataDirService,
  ) {}

  private isDemo(): boolean {
    return this.requestDataDir.isDemoMode();
  }

  /** Solde partagé : le vrai fichier hors démo, la copie démo sinon. */
  private currentSharedFile(): string {
    return this.isDemo() ? path.join(this.requestDataDir.getDataDir(), SHARED_FILENAME) : this.sharedFile;
  }

  private demoUsageFile(): string {
    return path.join(this.requestDataDir.getDataDir(), USAGE_FILENAME);
  }

  private loadDemoUsage(): MonthlyUsage {
    try {
      return JSON.parse(fs.readFileSync(this.demoUsageFile(), 'utf-8'));
    } catch {
      return {};
    }
  }

  onModuleInit() {
    if (fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    }
    this.startWatcher();
  }

  onModuleDestroy() {
    this.watcher?.close();
    if (this.emitTimer) clearTimeout(this.emitTimer);
  }

  private startWatcher() {
    if (!fs.existsSync(this.sharedDir)) {
      fs.mkdirSync(this.sharedDir, { recursive: true });
    }
    try {
      this.watcher = fs.watch(this.sharedDir, (_event, filename) => {
        if (filename !== SHARED_FILENAME) return;
        this.scheduleEmit();
      });
    } catch {
      // fs.watch unsupported (rare) — silently degrade; manual emits still fire
    }
  }

  private scheduleEmit() {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.bus.emit('claude-balance-changed');
    }, 200);
  }

  private currentMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private loadShared(file: string): SharedData {
    if (!fs.existsSync(file)) return { ...EMPTY_SHARED };
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err: unknown) {
      this.logger.warn(`Failed to read ${file}: ${(err as Error)?.message ?? err}`);
      return { ...EMPTY_SHARED };
    }
  }

  /**
   * Verrou cross-process sur claude-shared.json : le fichier est partagé par
   * les 3 backends NAS (finance/warhammer/ol) — sans lock, deux
   * read-modify-write concurrents perdent une mise à jour et le solde dérive.
   * Lockfile O_EXCL + vol de verrou périmé (>10 s, détenteur mort) +
   * fail-open après 2 s : mieux vaut un lost update rarissime qu'un endpoint
   * bloqué. (Dupliqué à l'identique dans les 3 apps, comme tout ce service.)
   */
  private withSharedLock<T>(file: string, fn: () => T): T {
    const lockPath = `${file}.lock`;
    const deadline = Date.now() + 2_000;
    for (;;) {
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        const fd = fs.openSync(lockPath, 'wx');
        try {
          return fn();
        } finally {
          fs.closeSync(fd);
          try { fs.unlinkSync(lockPath); } catch { /* volé entre-temps */ }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 10_000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch { continue; }
        if (Date.now() > deadline) {
          this.logger.warn('claude-shared.lock indisponible après 2 s — écriture sans verrou');
          return fn();
        }
        sleepSync(25);
      }
    }
  }


  recordUsage(inputTokens: number, outputTokens: number): void {
    const demo = this.isDemo();
    const data = demo ? this.loadDemoUsage() : this.data;
    const month = this.currentMonth();
    if (!data[month]) {
      data[month] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    }
    data[month].inputTokens += inputTokens;
    data[month].outputTokens += outputTokens;
    data[month].calls += 1;
    atomicWriteJsonSync(demo ? this.demoUsageFile() : this.filePath, data);

    const file = this.currentSharedFile();
    this.withSharedLock(file, () => {
      const shared = this.loadShared(file);
      shared.totalConsumedUsd += inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
      atomicWriteJsonSync(file, shared);
    });
  }

  setBalance(balanceUsd: number): void {
    const file = this.currentSharedFile();
    this.withSharedLock(file, () => {
      const shared = this.loadShared(file);
      shared.balanceUsd = balanceUsd;
      shared.balanceSetAt = new Date().toISOString();
      shared.totalConsumedUsdAtConfig = shared.totalConsumedUsd;
      atomicWriteJsonSync(file, shared);
    });
    // Le watcher ne surveille que le vrai dossier partagé : prévenir aussi
    // pour la copie démo.
    if (this.isDemo()) this.scheduleEmit();
  }

  getUsage(): UsageResponse {
    const month = this.currentMonth();
    const data = this.isDemo() ? this.loadDemoUsage() : this.data;
    const u = data[month] ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
    const costUsd = u.inputTokens * INPUT_USD_PER_TOKEN + u.outputTokens * OUTPUT_USD_PER_TOKEN;
    const estimatedCostEur = Math.round(costUsd * USD_TO_EUR * 100) / 100;
    const percent = Math.min(100, Math.round((estimatedCostEur / BUDGET_EUR) * 100));

    const shared = this.loadShared(this.currentSharedFile());
    const hasBalance = shared.balanceUsd !== null;
    let estimatedRemainingEur: number | null = null;
    let configuredBalanceEur: number | null = null;
    let remainingPercent: number | null = null;

    if (hasBalance && shared.balanceUsd !== null) {
      const consumed = shared.totalConsumedUsd - shared.totalConsumedUsdAtConfig;
      const remainingUsd = Math.max(0, shared.balanceUsd - consumed);
      estimatedRemainingEur = Math.round(remainingUsd * USD_TO_EUR * 100) / 100;
      configuredBalanceEur = Math.round(shared.balanceUsd * USD_TO_EUR * 100) / 100;
      remainingPercent = Math.round((remainingUsd / shared.balanceUsd) * 100);
    }

    return { month, ...u, estimatedCostEur, budgetEur: BUDGET_EUR, percent, hasBalance, estimatedRemainingEur, configuredBalanceEur, remainingPercent };
  }
}
