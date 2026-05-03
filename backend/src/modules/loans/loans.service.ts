import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Loan, LoanInput, LoanOccurrence } from '../../models/loan.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'loans.json');
  }

  async getAll(): Promise<Loan[]> {
    try {
      const c = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(c) as Loan[];
    } catch { return []; }
  }

  async getOne(id: string): Promise<Loan> {
    const l = (await this.getAll()).find((x) => x.id === id);
    if (!l) throw new NotFoundException(`Crédit ${id} introuvable`);
    return l;
  }

  async create(input: LoanInput): Promise<Loan> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const loan: Loan = { ...input, id: randomUUID(), occurrencesDetected: [], createdAt: now, updatedAt: now };
    all.push(loan);
    await this.persist(all);
    this.logger.log(`Created loan ${loan.id} (${loan.name})`);
    return loan;
  }

  async update(id: string, input: LoanInput): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    all[idx] = {
      ...all[idx],
      ...input,
      id: all[idx].id,
      occurrencesDetected: all[idx].occurrencesDetected,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(all);
    return all[idx];
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((l) => l.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Crédit ${id} introuvable`);
    await this.persist(next);
  }

  async addOccurrence(
    id: string,
    occ: { statementId: string; date: string; amount: number; transactionId: string | null },
  ): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];
    const dupKey = (o: LoanOccurrence) => `${o.statementId}|${o.transactionId ?? ''}`;
    const newKey = `${occ.statementId}|${occ.transactionId ?? ''}`;
    if (loan.occurrencesDetected.some((o) => dupKey(o) === newKey)) {
      this.logger.debug(`Skipping duplicate occurrence on loan ${id}`);
      return loan;
    }
    const newOcc: LoanOccurrence = { id: randomUUID(), ...occ };
    loan.occurrencesDetected.push(newOcc);
    if (loan.type === 'revolving' && loan.usedAmount != null) {
      loan.usedAmount = Math.max(0, Math.round((loan.usedAmount - Math.abs(occ.amount)) * 100) / 100);
    }
    loan.updatedAt = new Date().toISOString();
    await this.persist(all);
    return loan;
  }

  async removeOccurrencesForStatement(statementId: string): Promise<void> {
    const all = await this.getAll();
    let dirty = false;
    for (const loan of all) {
      const before = loan.occurrencesDetected.length;
      loan.occurrencesDetected = loan.occurrencesDetected.filter((o) => o.statementId !== statementId);
      if (loan.occurrencesDetected.length !== before) {
        dirty = true;
        loan.updatedAt = new Date().toISOString();
      }
    }
    if (dirty) await this.persist(all);
  }

  async resetRevolving(id: string, newUsedAmount: number): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    if (all[idx].type !== 'revolving') throw new BadRequestException('Reset valide uniquement pour revolving');
    if (all[idx].maxAmount != null && newUsedAmount > all[idx].maxAmount) {
      throw new BadRequestException('usedAmount > maxAmount');
    }
    all[idx].usedAmount = newUsedAmount;
    all[idx].lastManualResetAt = new Date().toISOString();
    all[idx].updatedAt = new Date().toISOString();
    await this.persist(all);
    return all[idx];
  }

  async clearOccurrencesAndResetBalance(id: string, baselineUsedAmount?: number): Promise<void> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];
    loan.occurrencesDetected = [];
    if (loan.type === 'revolving' && baselineUsedAmount !== undefined) {
      if (loan.maxAmount != null && baselineUsedAmount > loan.maxAmount) {
        throw new BadRequestException('baselineUsedAmount > maxAmount');
      }
      loan.usedAmount = baselineUsedAmount;
    }
    loan.updatedAt = new Date().toISOString();
    await this.persist(all);
  }

  /**
   * Découpe un loan en plusieurs sous-loans selon les montants distincts
   * trouvés dans ses occurrencesDetected (regroupés à l'euro près).
   * Utile quand un creditor (ex: Klarna) a en réalité plusieurs prêts BNPL
   * fusionnés en un seul Loan.
   */
  async splitByAmount(id: string): Promise<{ split: boolean; createdCount: number; groups: Array<{ amount: number; count: number }> }> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const original = all[idx];
    if (original.occurrencesDetected.length < 2) {
      return { split: false, createdCount: 0, groups: [] };
    }

    // Group occurrences by rounded amount
    const groups = new Map<number, LoanOccurrence[]>();
    for (const o of original.occurrencesDetected) {
      const k = Math.round(Math.abs(o.amount));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(o);
    }
    if (groups.size < 2) {
      return { split: false, createdCount: 0, groups: [{ amount: [...groups.keys()][0] ?? 0, count: original.occurrencesDetected.length }] };
    }

    // Sort groups by occurrence count descending — keep the largest in the original loan
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    const [keepKey, keepOccurrences] = sorted[0];
    const otherGroups = sorted.slice(1);

    // Update original to keep only its largest-count group
    const keepAvg = keepOccurrences.reduce((s, o) => s + Math.abs(o.amount), 0) / keepOccurrences.length;
    original.occurrencesDetected = keepOccurrences;
    original.monthlyPayment = Math.round(keepAvg * 100) / 100;
    if (!original.name.includes(`${keepKey} €`)) {
      original.name = `${original.creditor ?? original.name} (${original.monthlyPayment.toFixed(2)} €/mois)`;
    }
    original.updatedAt = new Date().toISOString();

    // Create one new Loan per remaining group
    const now = new Date().toISOString();
    let createdCount = 0;
    for (const [amountKey, occ] of otherGroups) {
      const avg = occ.reduce((s, o) => s + Math.abs(o.amount), 0) / occ.length;
      const newLoan: Loan = {
        id: randomUUID(),
        name: `${original.creditor ?? original.name.split(' (')[0]} (${avg.toFixed(2)} €/mois)`,
        type: original.type,
        category: original.category,
        monthlyPayment: Math.round(avg * 100) / 100,
        matchPattern: original.matchPattern,
        isActive: original.isActive,
        creditor: original.creditor,
        startDate: original.startDate,
        endDate: original.endDate,
        initialPrincipal: undefined,
        maxAmount: undefined,
        usedAmount: undefined,
        occurrencesDetected: occ,
        createdAt: now,
        updatedAt: now,
      };
      all.push(newLoan);
      createdCount++;
      this.logger.log(`Split: created ${newLoan.name} from ${original.id} with ${occ.length} occurrences`);
      void amountKey;
    }
    await this.persist(all);
    return {
      split: true,
      createdCount,
      groups: [...groups.entries()].map(([amount, occ]) => ({ amount, count: occ.length })),
    };
  }

  private async persist(all: Loan[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loans-changed');
  }
}
