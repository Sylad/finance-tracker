import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { FinancialGoal, GoalInput, GoalWithProgress, GoalType } from '../../models/goal.model';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { EventBusService } from '../events/event-bus.service';

const FILE = 'goals.json';

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly storage: StorageService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), FILE);
  }

  async getAll(): Promise<FinancialGoal[]> {
    try {
      const content = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(content) as FinancialGoal[];
    } catch {
      return [];
    }
  }

  async create(input: GoalInput): Promise<FinancialGoal> {
    if (!input.name?.trim()) throw new BadRequestException('name requis');
    if (!Number.isFinite(input.targetAmount) || input.targetAmount <= 0) {
      throw new BadRequestException('targetAmount invalide (>0)');
    }
    if (input.type !== 'savings_total' && input.type !== 'net_worth') {
      throw new BadRequestException('type invalide');
    }
    const all = await this.getAll();
    const startAmount = input.startAmount ?? (await this.computeCurrentAmount(input.type));
    const goal: FinancialGoal = {
      id: randomUUID(),
      name: input.name.trim(),
      type: input.type,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate?.trim() || null,
      startAmount,
      startDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    all.push(goal);
    await this.persist(all);
    this.logger.log(`Created goal ${goal.id} (${goal.name})`);
    return goal;
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((g) => g.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Objectif ${id} introuvable`);
    await this.persist(next);
  }

  async getAllWithProgress(): Promise<GoalWithProgress[]> {
    const goals = await this.getAll();
    const out: GoalWithProgress[] = [];
    for (const g of goals) out.push(await this.computeProgress(g));
    return out;
  }

  private async computeProgress(g: FinancialGoal): Promise<GoalWithProgress> {
    const current = await this.computeCurrentAmount(g.type);
    const totalNeeded = g.targetAmount - g.startAmount;
    const done = current - g.startAmount;
    const progressPct = totalNeeded > 0
      ? Math.max(0, Math.min(100, Math.round((done / totalNeeded) * 100)))
      : current >= g.targetAmount ? 100 : 0;
    const remaining = Math.max(0, g.targetAmount - current);

    const start = new Date(g.startDate);
    const now = new Date();
    const monthsElapsed = Math.max(0, monthDiff(start, now));

    let monthsRemaining: number | null = null;
    let monthlyPaceNeeded: number | null = null;
    let projection: GoalWithProgress['projection'] = 'no-deadline';

    if (current >= g.targetAmount) {
      projection = 'achieved';
    } else if (g.targetDate) {
      const target = new Date(g.targetDate);
      monthsRemaining = Math.max(0, monthDiff(now, target));
      monthlyPaceNeeded = monthsRemaining > 0 ? remaining / monthsRemaining : remaining;
      const expectedAtNow = monthsElapsed > 0
        ? g.startAmount + (totalNeeded / Math.max(1, monthDiff(start, target))) * monthsElapsed
        : g.startAmount;
      if (current >= expectedAtNow) projection = 'on-track';
      const aheadThreshold = expectedAtNow + Math.abs(totalNeeded) * 0.05;
      if (current >= aheadThreshold) projection = 'ahead';
      const behindThreshold = expectedAtNow - Math.abs(totalNeeded) * 0.05;
      if (current < behindThreshold) projection = 'behind';
    }

    return {
      ...g,
      currentAmount: round2(current),
      progressPct,
      remaining: round2(remaining),
      monthlyPaceNeeded: monthlyPaceNeeded != null ? round2(monthlyPaceNeeded) : null,
      projection,
      monthsElapsed,
      monthsRemaining,
    };
  }

  private async computeCurrentAmount(type: GoalType): Promise<number> {
    if (type === 'savings_total') {
      const accounts = await this.savings.getAll();
      return accounts.reduce((s, a) => s + a.currentBalance, 0);
    }
    if (type === 'net_worth') {
      const accounts = await this.savings.getAll();
      const savings = accounts.reduce((s, a) => s + a.currentBalance, 0);
      const loans = await this.loans.getAll();
      const debt = loans.filter((l) => l.isActive).reduce((s, l) => s + this.estimateLoanBalance(l), 0);
      const stmts = await this.storage.getAllStatements();
      const latest = stmts.sort((a, b) => b.id.localeCompare(a.id))[0];
      const liquid = latest?.closingBalance ?? 0;
      return liquid + savings - debt;
    }
    return 0;
  }

  private estimateLoanBalance(loan: { type: string; monthlyPayment?: number; usedAmount?: number; endDate?: string }): number {
    if (loan.type === 'revolving') return loan.usedAmount ?? 0;
    // Classic: estimated remaining = monthlyPayment × monthsUntilEnd
    if (loan.monthlyPayment && loan.endDate) {
      const end = new Date(loan.endDate);
      const now = new Date();
      const monthsLeft = Math.max(0, monthDiff(now, end));
      return loan.monthlyPayment * monthsLeft;
    }
    return 0;
  }

  private async persist(all: FinancialGoal[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('goals-changed');
  }
}

function monthDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
