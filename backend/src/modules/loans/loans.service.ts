import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Loan, LoanInput, LoanOccurrence, LoanStatementSnapshot } from '../../models/loan.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

export interface CreditStatementSnapshotInput {
  creditor: string;
  creditType: 'revolving' | 'classic';
  currentBalance: number;
  maxAmount?: number;
  monthlyPayment: number;
  endDate: string | null;
  taeg: number | null;
  statementDate: string;
}

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
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${this.filepath}: ${e?.message ?? err}`);
      }
      return [];
    }
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
    occ: { statementId: string; date: string; amount: number; transactionId: string | null; description?: string },
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
   * Découpe un loan en plusieurs sous-loans selon les groupes distincts
   * trouvés dans ses occurrencesDetected. La clé de groupement combine :
   * - le montant arrondi à l'euro
   * - une référence numérique extraite du libellé (numéro de contrat, IBAN
   *   destinataire, etc. — toute suite de >= 8 chiffres). Si pas de réf,
   *   le montant seul fait office de clé.
   *
   * Utile pour Klarna / Cofidis / Carrefour Banque qui ont N sous-prêts
   * distincts mensualisés séparément.
   */
  async splitByAmount(id: string): Promise<{ split: boolean; createdCount: number; groups: Array<{ key: string; amount: number; ref?: string; count: number }> }> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const original = all[idx];
    if (original.occurrencesDetected.length < 2) {
      return { split: false, createdCount: 0, groups: [] };
    }

    // Helper: extract ALL numeric sequences (>=8 digits) from a description
    const extractAllRefs = (desc: string | undefined): string[] => {
      if (!desc) return [];
      return [...desc.matchAll(/\d{8,}/g)].map((m) => m[0]);
    };

    // Pre-count global frequency of each numeric sequence across all occurrences.
    // A "stable" reference (= contract number) appears in ≥ 2 occurrences.
    // A unique sequence (= virement reference, unique per tx) is filtered out.
    const refCounts = new Map<string, number>();
    for (const o of original.occurrencesDetected) {
      for (const r of extractAllRefs(o.description)) {
        refCounts.set(r, (refCounts.get(r) ?? 0) + 1);
      }
    }
    // Pick the stable ref for an occurrence: longest then most frequent.
    const stableRef = (desc: string | undefined): string => {
      const refs = extractAllRefs(desc).filter((r) => (refCounts.get(r) ?? 0) >= 2);
      if (refs.length === 0) return '';
      return refs.sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        return (refCounts.get(b) ?? 0) - (refCounts.get(a) ?? 0);
      })[0];
    };

    // Filter to debits only (loans are negative-amount transactions).
    // Positive amounts (refunds, avoirs) are not credit repayments.
    const debits = original.occurrencesDetected.filter((o) => o.amount < 0);
    if (debits.length < 2) {
      return { split: false, createdCount: 0, groups: [] };
    }

    // Cluster occurrences:
    //  1) Group strictly by stable reference first (very strong signal).
    //  2) Within each ref-group (or within "no ref"), cluster amounts with
    //     a tolerance of ±5 % to absorb interest variations on the same loan.
    type Bucket = { amount: number; ref: string; occurrences: LoanOccurrence[] };
    const refGroups = new Map<string, LoanOccurrence[]>();
    for (const o of debits) {
      const ref = stableRef(o.description);
      if (!refGroups.has(ref)) refGroups.set(ref, []);
      refGroups.get(ref)!.push(o);
    }

    const allGroups = new Map<string, Bucket>();
    for (const [ref, occList] of refGroups.entries()) {
      // Sort by amount asc to cluster adjacent amounts
      const sortedOcc = [...occList].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
      const buckets: Bucket[] = [];
      for (const o of sortedOcc) {
        const amt = Math.abs(o.amount);
        const last = buckets[buckets.length - 1];
        // Same bucket if within ±5 % of the bucket's centre (avg of its amounts).
        const lastAvg = last ? last.occurrences.reduce((s, x) => s + Math.abs(x.amount), 0) / last.occurrences.length : 0;
        const tolerance = lastAvg * 0.05;
        if (last && Math.abs(amt - lastAvg) <= tolerance) {
          last.occurrences.push(o);
        } else {
          buckets.push({ amount: Math.round(amt), ref, occurrences: [o] });
        }
      }
      // Re-key each bucket (use rounded median amount)
      for (const b of buckets) {
        const median = Math.round(b.occurrences.reduce((s, x) => s + Math.abs(x.amount), 0) / b.occurrences.length);
        b.amount = median;
        allGroups.set(`${median}|${ref}`, b);
      }
    }

    // Filter to groups that LOOK LIKE a real credit:
    //  - Seen across ≥ 3 distinct months (a credit lasts months/years)
    //  - At most 1 occurrence per month (excludes card payments)
    //  - For small amounts (< 30€), require ≥ 4 months (else likely subscription)
    const groups = new Map<string, { amount: number; ref: string; occurrences: LoanOccurrence[] }>();
    for (const [k, g] of allGroups.entries()) {
      const monthsSeen = new Set(g.occurrences.map((o) => o.date.slice(0, 7)));
      const maxPerMonth = Math.max(...[...monthsSeen].map((m) => g.occurrences.filter((o) => o.date.startsWith(m)).length));
      const minMonths = g.amount < 30 ? 4 : 3;
      if (monthsSeen.size >= minMonths && maxPerMonth <= 1) groups.set(k, g);
    }

    if (groups.size < 2) {
      const first = [...groups.values()][0];
      return { split: false, createdCount: 0, groups: [{ key: '0', amount: first?.amount ?? 0, ref: first?.ref, count: original.occurrencesDetected.length }] };
    }

    // Sort groups by occurrence count descending — keep the largest in the original loan
    const sorted = [...groups.entries()].sort((a, b) => b[1].occurrences.length - a[1].occurrences.length);
    const keepGroup = sorted[0][1];
    const otherGroups = sorted.slice(1);

    // Helper: name suffix from amount + ref
    const groupSuffix = (amount: number, ref: string): string => {
      const refTail = ref ? `…${ref.slice(-4)}` : '';
      return `(${amount.toFixed(2)} €/mois${refTail ? ` · ${refTail}` : ''})`;
    };

    // Update original to keep only its largest-count group
    const keepAvg = keepGroup.occurrences.reduce((s, o) => s + Math.abs(o.amount), 0) / keepGroup.occurrences.length;
    original.occurrencesDetected = keepGroup.occurrences;
    original.monthlyPayment = Math.round(keepAvg * 100) / 100;
    original.name = `${original.creditor ?? original.name.split(' (')[0]} ${groupSuffix(original.monthlyPayment, keepGroup.ref)}`;
    original.updatedAt = new Date().toISOString();

    // Create one new Loan per remaining group
    const now = new Date().toISOString();
    let createdCount = 0;
    for (const [, group] of otherGroups) {
      const avg = group.occurrences.reduce((s, o) => s + Math.abs(o.amount), 0) / group.occurrences.length;
      const newLoan: Loan = {
        id: randomUUID(),
        name: `${original.creditor ?? original.name.split(' (')[0]} ${groupSuffix(Math.round(avg * 100) / 100, group.ref)}`,
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
        occurrencesDetected: group.occurrences,
        createdAt: now,
        updatedAt: now,
      };
      all.push(newLoan);
      createdCount++;
      this.logger.log(`Split: created ${newLoan.name} from ${original.id} with ${group.occurrences.length} occurrences`);
    }
    await this.persist(all);
    return {
      split: true,
      createdCount,
      groups: [...groups.entries()].map(([key, g]) => ({ key, amount: g.amount, ref: g.ref || undefined, count: g.occurrences.length })),
    };
  }

  /**
   * Met à jour un loan à partir des valeurs extraites d'un relevé de crédit
   * (PDF analysé par Claude). Ne touche pas à `id`, `name`, `category`,
   * `matchPattern`, `occurrencesDetected`, `createdAt`. Stocke le snapshot
   * extrait dans `lastStatementSnapshot`.
   */
  async applyStatementSnapshot(
    id: string,
    extracted: CreditStatementSnapshotInput,
  ): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];

    if (extracted.creditType === 'revolving') {
      if (extracted.maxAmount != null && extracted.maxAmount > 0) {
        loan.maxAmount = extracted.maxAmount;
      }
      // Pour un revolving, currentBalance = utilisation actuelle
      loan.usedAmount = Math.max(0, extracted.currentBalance);
    } else {
      // classic : on n'écrase pas usedAmount/maxAmount qui sont revolving-only
      if (extracted.endDate) loan.endDate = extracted.endDate;
    }

    if (Number.isFinite(extracted.monthlyPayment) && extracted.monthlyPayment > 0) {
      loan.monthlyPayment = extracted.monthlyPayment;
    }

    // Renseigne creditor uniquement s'il est vide (l'utilisateur garde la main).
    if (!loan.creditor && extracted.creditor) {
      loan.creditor = extracted.creditor;
    }

    const snapshot: LoanStatementSnapshot = {
      date: new Date().toISOString(),
      source: 'pdf-import',
      extractedValues: {
        currentBalance: extracted.currentBalance,
        maxAmount: extracted.maxAmount,
        monthlyPayment: extracted.monthlyPayment,
        endDate: extracted.endDate,
        statementDate: extracted.statementDate,
        taeg: extracted.taeg,
      },
    };
    loan.lastStatementSnapshot = snapshot;
    loan.updatedAt = new Date().toISOString();

    await this.persist(all);
    return loan;
  }

  private async persist(all: Loan[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loans-changed');
  }
}
