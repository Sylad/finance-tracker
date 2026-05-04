import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  BalanceHistoryEntry,
  SavingsAccount,
  SavingsAccountInput,
  SavingsAccountType,
  SavingsMovement,
  SavingsMovementSource,
} from '../../models/savings-account.model';
import { ExternalAccountBalance } from '../../models/monthly-statement.model';

const DEFAULT_RATES: Record<SavingsAccountType, number> = {
  'livret-a': 0.015,
  pel: 0.02,
  cel: 0.0125,
  ldds: 0.015,
  pea: 0,
  other: 0,
};

const DEFAULT_ANNIVERSARY_MONTH: Record<SavingsAccountType, number> = {
  'livret-a': 12,
  pel: 1,
  cel: 12,
  ldds: 12,
  pea: 12,
  other: 12,
};

const TYPE_LABELS: Record<SavingsAccountType, string> = {
  'livret-a': 'Livret A',
  pel: 'PEL',
  cel: 'CEL',
  ldds: 'LDDS',
  pea: 'PEA',
  other: 'Compte épargne',
};

function normalizeAccountNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[^0-9A-Z]/gi, '').toUpperCase();
}
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'savings-accounts.json');
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
      // Build the YYYY-MM label and last day of month from local components
      // (toISOString() drifts to UTC and shifts midnight values to the previous day,
      // which silently shifted the month label by one in CEST/CET).
      const year = now.getFullYear();
      const monthIndex = now.getMonth() - i;
      const d = new Date(year, monthIndex, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
      while (cursor < sorted.length && sorted[cursor].date <= monthEndStr) {
        running += sorted[cursor].amount;
        cursor++;
      }
      result.push({
        month: monthLabel,
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

  async clearDetectedMovements(id: string): Promise<void> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    const acc = all[idx];
    const detected = acc.movements.filter((m) => m.source === 'detected' || m.source === 'interest');
    if (detected.length === 0) return;
    const delta = detected.reduce((s, m) => s + m.amount, 0);
    acc.movements = acc.movements.filter((m) => m.source !== 'detected' && m.source !== 'interest');
    acc.currentBalance = Math.round((acc.currentBalance - delta) * 100) / 100;
    acc.updatedAt = new Date().toISOString();
    await this.persist(all);
  }

  /**
   * Auto-discovery : crée un SavingsAccount à partir d'une ExternalAccountBalance extraite du PDF
   * si aucun compte avec ce numéro n'existe déjà. Idempotent.
   */
  async upsertFromBankExtract(
    eb: ExternalAccountBalance,
    statementMonth: number,
    statementYear: number,
  ): Promise<{ account: SavingsAccount; created: boolean }> {
    const normTarget = normalizeAccountNumber(eb.accountNumber);
    if (!normTarget) {
      throw new Error('upsertFromBankExtract: accountNumber vide');
    }
    const all = await this.getAll();
    const existing = all.find((a) => a.accountNumber && normalizeAccountNumber(a.accountNumber) === normTarget);
    if (existing) {
      return { account: existing, created: false };
    }
    const type: SavingsAccountType = (
      ['livret-a', 'pel', 'cel', 'ldds', 'pea'].includes(eb.accountType) ? eb.accountType : 'other'
    ) as SavingsAccountType;
    const monthEnd = new Date(statementYear, statementMonth, 0).toISOString().slice(0, 10);
    const created = await this.create({
      name: eb.label?.trim() || `${TYPE_LABELS[type]} ${eb.accountNumber.slice(-4)}`,
      type,
      initialBalance: eb.balance,
      initialBalanceDate: eb.asOfDate || monthEnd,
      matchPattern: '',
      interestRate: DEFAULT_RATES[type],
      interestAnniversaryMonth: DEFAULT_ANNIVERSARY_MONTH[type],
      accountNumber: eb.accountNumber,
    });
    this.logger.log(`Auto-created savings account ${created.id} (${created.name}) from bank extract`);
    return { account: created, created: true };
  }

  private async persist(all: SavingsAccount[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('savings-changed');
  }
}
