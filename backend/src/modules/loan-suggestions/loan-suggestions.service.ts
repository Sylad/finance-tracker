import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJson } from '../../common/atomic-write';
import {
  IncomingSuggestion,
  LoanSuggestion,
} from '../../models/loan-suggestion.model';
import { Loan } from '../../models/loan.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { LoansService } from '../loans/loans.service';

@Injectable()
export class LoanSuggestionsService {
  private readonly logger = new Logger(LoanSuggestionsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
    private readonly loans: LoansService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'loan-suggestions.json');
  }

  async getAll(): Promise<LoanSuggestion[]> {
    try {
      return JSON.parse(
        await fs.promises.readFile(this.filepath, 'utf8'),
      ) as LoanSuggestion[];
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(
          `Failed to read ${this.filepath}: ${e?.message ?? err}`,
        );
      }
      return [];
    }
  }

  async getPending(): Promise<LoanSuggestion[]> {
    return (await this.getAll()).filter(
      (s) => s.status === 'pending' || s.status === 'snoozed',
    );
  }

  async upsertMany(
    statementId: string,
    incoming: IncomingSuggestion[],
  ): Promise<void> {
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
        if (inc.creditor && !existing.creditor)
          existing.creditor = inc.creditor;
        // Pass-through simple : ne clobber jamais un installment/source déjà
        // présent avec un incoming qui n'en porte pas (ex. relevé standard
        // qui re-matche une suggestion créée par la détection LLM).
        if (inc.installment) existing.installment = inc.installment;
        if (inc.source) existing.source = inc.source;
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
          ...(inc.installment ? { installment: inc.installment } : {}),
          ...(inc.source ? { source: inc.source } : {}),
          status: 'pending',
          createdAt: now,
        });
        dirty = true;
      }
    }
    if (dirty) await this.persist(all);
  }

  private dedupKey(s: { creditor?: string; matchPattern: string }): string {
    if (s.creditor && s.creditor.trim())
      return 'creditor:' + s.creditor.toLowerCase().trim();
    return (
      'pattern:' + s.matchPattern.toLowerCase().replace(/\s+/g, ' ').trim()
    );
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

  /**
   * Accepte une suggestion N× (`installment` présent, détectée par le LLM
   * — cf DetectionValidatorService) en créant un Loan `kind='installment'`
   * avec un échéancier reconstruit depuis les occurrences observées
   * (`installment.dates`/`installment.amounts`), complété par projection si
   * `installment.count` dépasse le nombre d'occurrences observées.
   *
   * 404 si la suggestion n'existe pas ; 400 si elle n'a pas de champ
   * `installment` ou si elle est déjà `accepted` (idempotence stricte —
   * on ne veut pas créer un second loan pour la même suggestion).
   */
  async acceptInstallment(id: string): Promise<LoanSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    const suggestion = all[idx];
    if (!suggestion.installment) {
      throw new BadRequestException(
        `Suggestion ${id} sans détail installment — impossible de construire un échéancier`,
      );
    }
    if (suggestion.status === 'accepted') {
      throw new BadRequestException(`Suggestion ${id} déjà acceptée`);
    }

    const { installment } = suggestion;
    const occurrences = installment.dates.map((date, i) => ({
      date,
      amount: installment.amounts[i] ?? 0,
    }));
    const schedule = LoansService.buildInstallmentSchedule(
      occurrences,
      installment.count,
    );
    const creditorLabel = suggestion.creditor ?? suggestion.label;
    const merchantSuffix = installment.merchant
      ? ` · ${installment.merchant}`
      : '';
    const count = installment.count ?? occurrences.length;

    const loan: Loan = await this.loans.create({
      name: `${count}× ${creditorLabel}${merchantSuffix}`,
      type: 'classic',
      kind: 'installment',
      category: 'consumer',
      monthlyPayment: suggestion.monthlyAmount,
      matchPattern: LoanSuggestionsService.escapeRegex(creditorLabel),
      isActive: true,
      creditor: suggestion.creditor,
      startDate: schedule[0]?.dueDate,
      endDate: schedule[schedule.length - 1]?.dueDate,
      installmentSchedule: schedule,
      installmentMerchant: installment.merchant ?? undefined,
      installmentSignatureDate: schedule[0]?.dueDate,
    });

    this.logger.log(
      `Accepted installment suggestion ${id} → loan ${loan.id} (${schedule.length} échéances)`,
    );
    return this.accept(id, { loanId: loan.id });
  }

  private static escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    if (target?.subscriptionId)
      all[idx].acceptedAsSubscriptionId = target.subscriptionId;
    await this.persist(all);
    return all[idx];
  }

  /**
   * Purge totale des suggestions — utilisé par /loans/reset pour repartir
   * d'une base saine avant replay auto-sync.
   */
  async deleteAll(): Promise<{ deletedCount: number }> {
    const all = await this.getAll();
    await this.persist([]);
    this.logger.log(`Deleted all ${all.length} loan suggestions`);
    return { deletedCount: all.length };
  }

  /**
   * Reset toutes les suggestions à status='pending'. Utilisé par /loans/reset
   * pour donner une seconde chance aux suggestions snoozed/rejected/accepted
   * lors du replay auto-sync (avec nouvel invariant).
   * Conserve l'historique (id, occurrencesSeen, dates) — efface seulement
   * status, resolvedAt, acceptedAsLoanId, acceptedAsSubscriptionId.
   */
  async resetAllToPending(): Promise<{ resetCount: number }> {
    const all = await this.getAll();
    let resetCount = 0;
    for (const s of all) {
      if (s.status !== 'pending') {
        s.status = 'pending';
        delete s.resolvedAt;
        delete s.acceptedAsLoanId;
        delete s.acceptedAsSubscriptionId;
        resetCount++;
      }
    }
    if (resetCount > 0) await this.persist(all);
    this.logger.log(`Reset ${resetCount} loan suggestions to pending`);
    return { resetCount };
  }

  private async persist(all: LoanSuggestion[]): Promise<void> {
    await atomicWriteJson(this.filepath, all);
    this.bus.emit('loan-suggestions-changed');
  }
}
