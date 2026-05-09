import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { IncomingSuggestion, LoanSuggestion } from '../../models/loan-suggestion.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class LoanSuggestionsService {
  private readonly logger = new Logger(LoanSuggestionsService.name);

  constructor(private readonly dataDir: RequestDataDirService, private readonly bus: EventBusService) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'loan-suggestions.json');
  }

  async getAll(): Promise<LoanSuggestion[]> {
    try {
      return JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as LoanSuggestion[];
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${this.filepath}: ${e?.message ?? err}`);
      }
      return [];
    }
  }

  async getPending(): Promise<LoanSuggestion[]> {
    return (await this.getAll()).filter((s) => s.status === 'pending' || s.status === 'snoozed');
  }

  async upsertMany(statementId: string, incoming: IncomingSuggestion[]): Promise<void> {
    if (incoming.length === 0) return;
    const all = await this.getAll();
    const now = new Date().toISOString();
    let dirty = false;
    for (const inc of incoming) {
      const existing = all.find((s) => this.dedupKey(s) === this.dedupKey(inc));
      if (existing) {
        if (existing.status === 'rejected') continue;
        existing.occurrencesSeen = inc.occurrencesSeen;
        existing.lastSeenDate = inc.firstSeenDate;
        existing.monthlyAmount = inc.monthlyAmount;
        existing.label = inc.label;
        if (inc.creditor && !existing.creditor) existing.creditor = inc.creditor;
        dirty = true;
      } else {
        all.push({
          id: randomUUID(),
          label: inc.label,
          monthlyAmount: inc.monthlyAmount,
          occurrencesSeen: inc.occurrencesSeen,
          firstSeenStatementId: statementId,
          firstSeenDate: inc.firstSeenDate,
          lastSeenDate: inc.firstSeenDate,
          suggestedType: inc.suggestedType,
          matchPattern: inc.matchPattern,
          ...(inc.creditor ? { creditor: inc.creditor } : {}),
          status: 'pending',
          createdAt: now,
        });
        dirty = true;
      }
    }
    if (dirty) await this.persist(all);
  }

  private dedupKey(s: { creditor?: string; matchPattern: string }): string {
    if (s.creditor && s.creditor.trim()) return 'creditor:' + s.creditor.toLowerCase().trim();
    return 'pattern:' + s.matchPattern.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  async accept(
    id: string,
    target: { loanId?: string; subscriptionId?: string },
  ): Promise<LoanSuggestion> {
    return this.transition(id, 'accepted', target);
  }

  async reject(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'rejected');
  }

  async snooze(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'snoozed');
  }

  async unsnooze(id: string): Promise<LoanSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = 'pending';
    delete all[idx].resolvedAt;
    await this.persist(all);
    return all[idx];
  }

  private async transition(
    id: string,
    status: LoanSuggestion['status'],
    target?: { loanId?: string; subscriptionId?: string },
  ): Promise<LoanSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = status;
    all[idx].resolvedAt = new Date().toISOString();
    if (target?.loanId) all[idx].acceptedAsLoanId = target.loanId;
    if (target?.subscriptionId) all[idx].acceptedAsSubscriptionId = target.subscriptionId;
    await this.persist(all);
    return all[idx];
  }

  private async persist(all: LoanSuggestion[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loan-suggestions-changed');
  }
}
