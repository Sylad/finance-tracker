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
import { escapeRegex } from '../../common/regex.util';

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
   * Seed aussi `occurrencesDetected` (via `addOccurrence`, une par
   * occurrence observée) — sans ça `computeLoanState().totalPaid` reste à 0
   * et la dédup cross-loan de `syncInstallmentLoan` ne voit pas ces tx
   * comme déjà attribuées. `InstallmentSuggestionInfo` ne porte pas de
   * statementId par occurrence (seulement date/amount/transactionId) : on
   * reconstruit un statementId synthétique `YYYY-MM` depuis la date.
   *
   * `isActive` : comme `convertToInstallment`, si toutes les échéances du
   * schedule (observées + projetées) ont une dueDate déjà passée, la série
   * est terminée → loan créé inactif d'emblée.
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
    // statementId synthétique 'YYYY-MM' — InstallmentSuggestionInfo ne
    // porte pas de statementId d'origine par occurrence.
    const zipped = installment.dates.map((date, i) => ({
      date,
      amount: installment.amounts[i] ?? 0,
      transactionId: installment.occurrenceTxIds[i] ?? null,
      statementId: date.slice(0, 7),
    }));
    const sortedOccurrences = [...zipped].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const schedule = LoansService.buildInstallmentSchedule(
      sortedOccurrences.map((o) => ({ date: o.date, amount: o.amount })),
      installment.count,
    );
    // paidOccurrenceId n'est renseigné qu'après le seed des occurrences
    // ci-dessous — il doit référencer le vrai id (uuid) de la
    // LoanOccurrence créée par addOccurrence, pas un id synthétique.

    const today = new Date().toISOString().slice(0, 10);
    const allPast = schedule.every((s) => s.dueDate <= today);

    const creditorLabel = suggestion.creditor ?? suggestion.label;
    const merchantSuffix = installment.merchant
      ? ` · ${installment.merchant}`
      : '';
    const count = installment.count ?? sortedOccurrences.length;

    const loan: Loan = await this.loans.create({
      name: `${count}× ${creditorLabel}${merchantSuffix}`,
      type: 'classic',
      kind: 'installment',
      category: 'consumer',
      monthlyPayment: suggestion.monthlyAmount,
      matchPattern: escapeRegex(creditorLabel),
      isActive: !allPast,
      creditor: suggestion.creditor,
      startDate: schedule[0]?.dueDate,
      endDate: schedule[schedule.length - 1]?.dueDate,
      installmentSchedule: schedule,
      installmentMerchant: installment.merchant ?? undefined,
      installmentSignatureDate: schedule[0]?.dueDate,
    });

    // Seed occurrencesDetected — 1 par occurrence observée. amounts stockés
    // positifs côté InstallmentSuggestionInfo, l'occurrence porte le débit
    // (négatif). statementId synthétique 'YYYY-MM' (pas d'original porté
    // par InstallmentSuggestionInfo).
    for (const o of sortedOccurrences) {
      await this.loans.addOccurrence(loan.id, {
        statementId: o.statementId,
        date: o.date,
        amount: -Math.abs(o.amount),
        transactionId: o.transactionId,
        source: 'bank_statement',
      });
    }

    // paidOccurrenceId doit référencer le vrai id (uuid) de la
    // LoanOccurrence créée ci-dessus (contrat du champ — cf loan.model.ts),
    // pas le statementId synthétique. On relit le loan après le seed et on
    // retrouve chaque occurrence par son transactionId (pas par position :
    // addOccurrence peut dédupliquer/rejeter une occurrence).
    const seededLoan = await this.loans.getOne(loan.id);
    const occIdByTxId = new Map(
      seededLoan.occurrencesDetected
        .filter((occ) => occ.transactionId)
        .map((occ) => [occ.transactionId as string, occ.id]),
    );
    let scheduleDirty = false;
    for (let i = 0; i < sortedOccurrences.length && i < schedule.length; i++) {
      const txId = sortedOccurrences[i].transactionId;
      const realOccurrenceId = txId ? occIdByTxId.get(txId) : undefined;
      if (realOccurrenceId) {
        schedule[i] = { ...schedule[i], paidOccurrenceId: realOccurrenceId };
        scheduleDirty = true;
      }
    }
    if (scheduleDirty) {
      const {
        id: _id,
        occurrencesDetected: _occ,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...loanInput
      } = seededLoan;
      void _id;
      void _occ;
      void _createdAt;
      void _updatedAt;
      await this.loans.update(loan.id, {
        ...loanInput,
        installmentSchedule: schedule,
      });
    }

    this.logger.log(
      `Accepted installment suggestion ${id} → loan ${loan.id} (${schedule.length} échéances, ${sortedOccurrences.length} occurrences seedées)`,
    );
    return this.accept(id, { loanId: loan.id });
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
