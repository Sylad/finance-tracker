import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { MonthlyStatement, StatementSummary } from '../../models/monthly-statement.model';
import { ScoreHistoryEntry } from '../../models/financial-health-score.model';
import { RecurringCredit } from '../../models/recurring-credit.model';
import { YearlySummary } from '../../models/yearly-summary.model';
import { TransactionCategory } from '../../models/transaction.model';
import { RequestDataDirService } from '../demo/request-data-dir.service';

const FILENAME_REGEX = /^\d{4}-(0[1-9]|1[0-2])\.json$/;
const YEARLY_REGEX = /^\d{4}\.json$/;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataDir: RequestDataDirService,
  ) {}

  onModuleInit() {
    // Ensure base dirs exist for both normal AND demo locations.
    const real = this.config.get<string>('dataDir')!;
    for (const root of [real, path.join(real, 'demo')]) {
      fs.mkdirSync(path.join(root, 'statements', 'archive'), { recursive: true });
      fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
      fs.mkdirSync(path.join(root, 'yearly'), { recursive: true });
    }
  }

  private get statementsDir(): string {
    return path.resolve(this.dataDir.getDataDir(), 'statements');
  }

  private get archiveDir(): string {
    return path.resolve(this.statementsDir, 'archive');
  }

  private get yearlyDir(): string {
    return path.resolve(this.dataDir.getDataDir(), 'yearly');
  }

  async saveStatement(statement: MonthlyStatement): Promise<void> {
    const filename = `${statement.id}.json`;
    if (!FILENAME_REGEX.test(filename)) {
      throw new Error(`Invalid statement id: ${statement.id}`);
    }
    const filepath = path.join(this.statementsDir, filename);
    await fs.promises.writeFile(filepath, JSON.stringify(statement, null, 2), 'utf8');
    await this.archivePastYears();
  }

  async getStatement(id: string): Promise<MonthlyStatement | null> {
    const filepath = path.join(this.statementsDir, `${id}.json`);
    try {
      const content = await fs.promises.readFile(filepath, 'utf8');
      return JSON.parse(content) as MonthlyStatement;
    } catch {
      return null;
    }
  }

  async getAllStatements(): Promise<MonthlyStatement[]> {
    // Active statements (current year)
    const active = await this.readStatementsInDir(this.statementsDir);

    // Archived statements: scan archive/<year>/ for each subdirectory
    const archived: MonthlyStatement[] = [];
    try {
      const yearDirs = await fs.promises.readdir(this.archiveDir);
      for (const year of yearDirs) {
        const yearPath = path.join(this.archiveDir, year);
        const stat = await fs.promises.stat(yearPath).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const monthsInYear = await this.readStatementsInDir(yearPath);
        archived.push(...monthsInYear);
      }
    } catch {
      // archive dir absent — fine
    }

    return [...active, ...archived].sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }

  async getAllSummaries(): Promise<StatementSummary[]> {
    const statements = await this.getAllStatements();
    return statements.map((s) => ({
      id: s.id,
      month: s.month,
      year: s.year,
      uploadedAt: s.uploadedAt,
      bankName: s.bankName,
      accountHolder: s.accountHolder,
      currency: s.currency,
      openingBalance: s.openingBalance,
      closingBalance: s.closingBalance,
      totalCredits: s.totalCredits,
      totalDebits: s.totalDebits,
      healthScore: s.healthScore.total,
      trend: s.healthScore.trend,
      transactionCount: s.transactions.length,
    }));
  }

  async deleteStatement(id: string): Promise<boolean> {
    const filepath = path.join(this.statementsDir, `${id}.json`);
    try {
      await fs.promises.unlink(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async getScoreHistory(): Promise<ScoreHistoryEntry[]> {
    const statements = await this.getAllStatements();
    return statements
      .map((s) => ({ id: s.id, month: s.month, year: s.year, score: s.healthScore.total, trend: s.healthScore.trend }))
      .reverse();
  }

  async getAggregatedRecurringCredits(): Promise<RecurringCredit[]> {
    const statements = await this.getAllStatements();
    const creditMap = new Map<string, RecurringCredit>();
    for (const statement of statements) {
      for (const credit of statement.recurringCredits) {
        const key = credit.normalizedDescription.toLowerCase().trim();
        const existing = creditMap.get(key);
        if (!existing || credit.lastSeenDate > existing.lastSeenDate) {
          creditMap.set(key, credit);
        }
      }
    }
    return Array.from(creditMap.values()).sort((a, b) => b.monthlyAmount - a.monthlyAmount);
  }

  // ── Yearly summaries ──────────────────────────────────────────────────────

  async getAllYearlySummaries(): Promise<YearlySummary[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(this.yearlyDir);
    } catch {
      return [];
    }
    const summaries = await Promise.all(
      files
        .filter((f) => YEARLY_REGEX.test(f))
        .map(async (f) => {
          const content = await fs.promises.readFile(path.join(this.yearlyDir, f), 'utf8');
          return JSON.parse(content) as YearlySummary;
        }),
    );
    return summaries.sort((a, b) => b.year - a.year);
  }

  async getYearlySummary(year: number): Promise<YearlySummary | null> {
    const filepath = path.join(this.yearlyDir, `${year}.json`);
    try {
      const content = await fs.promises.readFile(filepath, 'utf8');
      return JSON.parse(content) as YearlySummary;
    } catch {
      return null;
    }
  }

  // ── Calendar-year archival ────────────────────────────────────────────────
  // After each save, any statement from a year strictly before the current
  // calendar year is moved into data/statements/archive/YYYY/ and the yearly
  // summary is regenerated from the full set (active + previously archived).
  // Moving rather than deleting preserves the raw monthly data so re-uploading
  // historical PDFs builds an accurate yearly summary.

  private async readStatementsInDir(dir: string): Promise<MonthlyStatement[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(dir);
    } catch {
      return [];
    }
    return Promise.all(
      files
        .filter((f) => FILENAME_REGEX.test(f))
        .map(async (f) => {
          const content = await fs.promises.readFile(path.join(dir, f), 'utf8');
          return JSON.parse(content) as MonthlyStatement;
        }),
    );
  }

  private async archivePastYears(): Promise<void> {
    const currentYear = new Date().getFullYear();
    const active = await this.getAllStatements();

    const byYear = new Map<number, MonthlyStatement[]>();
    for (const s of active) {
      if (s.year >= currentYear) continue;
      if (!byYear.has(s.year)) byYear.set(s.year, []);
      byYear.get(s.year)!.push(s);
    }

    for (const [year, justActive] of byYear.entries()) {
      const yearArchiveDir = path.join(this.archiveDir, String(year));
      await fs.promises.mkdir(yearArchiveDir, { recursive: true });

      for (const s of justActive) {
        const src = path.join(this.statementsDir, `${s.id}.json`);
        const dst = path.join(yearArchiveDir, `${s.id}.json`);
        await fs.promises.rename(src, dst);
        this.logger.log(`Archived ${s.id} → archive/${year}/`);
      }

      const archived = await this.readStatementsInDir(yearArchiveDir);
      const sorted = archived.sort((a, b) => a.month - b.month);
      await this.generateOrUpdateYearlySummary(year, sorted);
    }
  }

  private async generateOrUpdateYearlySummary(year: number, statements: MonthlyStatement[]): Promise<void> {
    if (statements.length === 0) return;

    const currency = statements[0].currency;
    const totalCredits = statements.reduce((s, m) => s + m.totalCredits, 0);
    const totalDebits = statements.reduce((s, m) => s + m.totalDebits, 0);
    const scores = statements.map((s) => ({ month: s.month, score: s.healthScore.total }));
    const avgScore = Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length);
    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    const worst = scores.reduce((a, b) => (b.score < a.score ? b : a));

    // Aggregate spending by category
    const categoryTotals = new Map<string, number>();
    for (const s of statements) {
      for (const t of s.transactions) {
        if (t.amount < 0) {
          const cat = t.category as TransactionCategory;
          categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + Math.abs(t.amount));
        }
      }
    }
    const topCategories = [...categoryTotals.entries()]
      .map(([category, totalAmount]) => ({ category, totalAmount: Math.round(totalAmount * 100) / 100 }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 6);

    const recurringCreditsCount = new Set(
      statements.flatMap((s) => s.recurringCredits.map((r) => r.normalizedDescription.toLowerCase())),
    ).size;

    const n = statements.length;
    const summary: YearlySummary = {
      year,
      generatedAt: new Date().toISOString(),
      monthsCovered: statements.map((s) => s.month).sort((a, b) => a - b),
      currency,
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalDebits: Math.round(totalDebits * 100) / 100,
      netSavings: Math.round((totalCredits - totalDebits) * 100) / 100,
      averageMonthlyCredits: Math.round((totalCredits / n) * 100) / 100,
      averageMonthlyDebits: Math.round((totalDebits / n) * 100) / 100,
      averageHealthScore: avgScore,
      bestMonth: best,
      worstMonth: worst,
      scoreProgression: scores,
      topCategories,
      recurringCreditsCount,
    };

    const filepath = path.join(this.yearlyDir, `${year}.json`);
    await fs.promises.writeFile(filepath, JSON.stringify(summary, null, 2), 'utf8');
    this.logger.log(`Generated yearly summary for ${year} (${n} months)`);
  }
}
