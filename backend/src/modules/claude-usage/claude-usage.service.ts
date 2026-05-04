import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EventBusService } from '../events/event-bus.service';

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
const SHARED_FILE = path.join(process.env['SHARED_DATA_DIR'] ?? path.resolve(process.cwd(), 'data', 'shared'), 'claude-shared.json');
const SHARED_FILENAME = path.basename(SHARED_FILE);
const SHARED_DIR = path.dirname(SHARED_FILE);

@Injectable()
export class ClaudeUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaudeUsageService.name);
  private readonly filePath = path.resolve(process.cwd(), 'data', 'claude-usage.json');
  private data: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
  private watcher: fs.FSWatcher | null = null;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly bus: EventBusService) {}

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
    if (!fs.existsSync(SHARED_DIR)) {
      fs.mkdirSync(SHARED_DIR, { recursive: true });
    }
    try {
      this.watcher = fs.watch(SHARED_DIR, (_event, filename) => {
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

  private loadShared(): SharedData {
    if (!fs.existsSync(SHARED_FILE)) {
      return { balanceUsd: null, balanceSetAt: null, totalConsumedUsdAtConfig: 0, totalConsumedUsd: 0 };
    }
    try {
      return JSON.parse(fs.readFileSync(SHARED_FILE, 'utf-8'));
    } catch (err: unknown) {
      this.logger.warn(`Failed to read ${SHARED_FILE}: ${(err as Error)?.message ?? err}`);
      return { balanceUsd: null, balanceSetAt: null, totalConsumedUsdAtConfig: 0, totalConsumedUsd: 0 };
    }
  }

  private saveShared(data: SharedData): void {
    fs.mkdirSync(path.dirname(SHARED_FILE), { recursive: true });
    fs.writeFileSync(SHARED_FILE, JSON.stringify(data, null, 2));
  }

  recordUsage(inputTokens: number, outputTokens: number): void {
    const month = this.currentMonth();
    if (!this.data[month]) {
      this.data[month] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    }
    this.data[month].inputTokens += inputTokens;
    this.data[month].outputTokens += outputTokens;
    this.data[month].calls += 1;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));

    const shared = this.loadShared();
    shared.totalConsumedUsd += inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
    this.saveShared(shared);
  }

  setBalance(balanceUsd: number): void {
    const shared = this.loadShared();
    shared.balanceUsd = balanceUsd;
    shared.balanceSetAt = new Date().toISOString();
    shared.totalConsumedUsdAtConfig = shared.totalConsumedUsd;
    this.saveShared(shared);
  }

  getUsage(): UsageResponse {
    const month = this.currentMonth();
    const u = this.data[month] ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
    const costUsd = u.inputTokens * INPUT_USD_PER_TOKEN + u.outputTokens * OUTPUT_USD_PER_TOKEN;
    const estimatedCostEur = Math.round(costUsd * USD_TO_EUR * 100) / 100;
    const percent = Math.min(100, Math.round((estimatedCostEur / BUDGET_EUR) * 100));

    const shared = this.loadShared();
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
