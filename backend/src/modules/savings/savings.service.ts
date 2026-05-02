import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  BalanceHistoryEntry,
  SavingsAccount,
  SavingsAccountInput,
  SavingsMovement,
  SavingsMovementSource,
} from '../../models/savings-account.model';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class SavingsService implements OnModuleInit {
  private readonly logger = new Logger(SavingsService.name);
  private filepath!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit() {
    this.filepath = path.resolve(this.config.get<string>('dataDir')!, 'savings-accounts.json');
  }

  async getAll(): Promise<SavingsAccount[]> {
    try {
      const content = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(content) as SavingsAccount[];
    } catch {
      return [];
    }
  }

  async getOne(id: string): Promise<SavingsAccount> {
    const all = await this.getAll();
    const acc = all.find((a) => a.id === id);
    if (!acc) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    return acc;
  }

  async create(input: SavingsAccountInput): Promise<SavingsAccount> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const initialMovement: SavingsMovement = {
      id: randomUUID(),
      date: input.initialBalanceDate,
      amount: input.initialBalance,
      source: 'initial',
      statementId: null,
      transactionId: null,
      note: 'Solde initial déclaré',
    };
    const acc: SavingsAccount = {
      ...input,
      id: randomUUID(),
      currentBalance: input.initialBalance,
      lastSyncedStatementId: null,
      movements: [initialMovement],
      createdAt: now,
      updatedAt: now,
    };
    all.push(acc);
    await this.persist(all);
    this.logger.log(`Created savings account ${acc.id} (${acc.name})`);
    return acc;
  }

  async update(id: string, input: SavingsAccountInput): Promise<SavingsAccount> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    all[idx] = {
      ...all[idx],
      ...input,
      id: all[idx].id,
      currentBalance: all[idx].currentBalance,
      movements: all[idx].movements,
      lastSyncedStatementId: all[idx].lastSyncedStatementId,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(all);
    return all[idx];
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    await this.persist(next);
  }

  async addMovement(
    id: string,
    movement: { date: string; amount: number; source: SavingsMovementSource; statementId?: string | null; transactionId?: string | null; note?: string },
  ): Promise<SavingsAccount> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    const mv: SavingsMovement = {
      id: randomUUID(),
      date: movement.date,
      amount: movement.amount,
      source: movement.source,
      statementId: movement.statementId ?? null,
      transactionId: movement.transactionId ?? null,
      note: movement.note,
    };
    all[idx].movements.push(mv);
    all[idx].currentBalance = Math.round((all[idx].currentBalance + movement.amount) * 100) / 100;
    all[idx].updatedAt = new Date().toISOString();
    await this.persist(all);
    return all[idx];
  }

  async getBalanceHistory(id: string, months = 12): Promise<BalanceHistoryEntry[]> {
    const acc = await this.getOne(id);
    const sorted = [...acc.movements].sort((a, b) => a.date.localeCompare(b.date));
    const now = new Date();
    const result: BalanceHistoryEntry[] = [];
    let running = 0;
    let cursor = 0;
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthEndStr = monthEnd.toISOString().slice(0, 10);
      while (cursor < sorted.length && sorted[cursor].date <= monthEndStr) {
        running += sorted[cursor].amount;
        cursor++;
      }
      result.push({
        month: d.toISOString().slice(0, 7),
        balance: Math.round(running * 100) / 100,
      });
    }
    return result;
  }

  async removeMovementsForStatement(statementId: string): Promise<void> {
    const all = await this.getAll();
    let dirty = false;
    for (const acc of all) {
      const removed = acc.movements.filter((m) => m.statementId === statementId);
      if (removed.length === 0) continue;
      acc.movements = acc.movements.filter((m) => m.statementId !== statementId);
      const delta = removed.reduce((s, m) => s + m.amount, 0);
      acc.currentBalance = Math.round((acc.currentBalance - delta) * 100) / 100;
      acc.updatedAt = new Date().toISOString();
      dirty = true;
      this.logger.log(`Removed ${removed.length} movements for statement ${statementId} on ${acc.id}`);
    }
    if (dirty) await this.persist(all);
  }

  private async persist(all: SavingsAccount[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('savings-changed');
  }
}
