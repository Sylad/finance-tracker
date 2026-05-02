import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { IncomingSuggestion, LoanSuggestion } from '../../models/loan-suggestion.model';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class LoanSuggestionsService implements OnModuleInit {
  private readonly logger = new Logger(LoanSuggestionsService.name);
  private filepath!: string;

  constructor(private readonly config: ConfigService, private readonly bus: EventBusService) {}

  onModuleInit() {
    this.filepath = path.resolve(this.config.get<string>('dataDir')!, 'loan-suggestions.json');
  }

  async getAll(): Promise<LoanSuggestion[]> {
    try {
      return JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as LoanSuggestion[];
    } catch { return []; }
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
      const existing = all.find((s) => this.normalizePattern(s.matchPattern) === this.normalizePattern(inc.matchPattern));
      if (existing) {
        if (existing.status === 'rejected') continue;
        existing.occurrencesSeen = inc.occurrencesSeen;
        existing.lastSeenDate = inc.firstSeenDate;
        existing.monthlyAmount = inc.monthlyAmount;
        existing.label = inc.label;
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
          status: 'pending',
          createdAt: now,
        });
        dirty = true;
      }
    }
    if (dirty) await this.persist(all);
  }

  async accept(id: string, loanId: string): Promise<LoanSuggestion> {
    return this.transition(id, 'accepted', loanId);
  }

  async reject(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'rejected');
  }

  async snooze(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'snoozed');
  }

  private async transition(id: string, status: LoanSuggestion['status'], loanId?: string): Promise<LoanSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = status;
    all[idx].resolvedAt = new Date().toISOString();
    if (loanId) all[idx].acceptedAsLoanId = loanId;
    await this.persist(all);
    return all[idx];
  }

  private normalizePattern(p: string): string {
    return p.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private async persist(all: LoanSuggestion[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loan-suggestions-changed');
  }
}
