import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Loan, LoanInput, LoanOccurrence, LoanOccurrenceSource, LoanStatementSnapshot, AmortizationLine, LoanKind, InstallmentLine } from '../../models/loan.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { StorageService } from '../storage/storage.service';
import { PAY_IN_N_PATTERN } from './loans-patterns';

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

/**
 * Source d'un patch appliqué à un Loan. Détermine la priorité d'écrasement
 * dans `mergeLoanPatch` : user > amortization > credit_statement >
 * bank_statement > suggestion. Cf doc dans CLAUDE.md du repo.
 */
export type LoanPatchSource =
  | 'user'              // édition manuelle via formulaire
  | 'amortization'      // PDF tableau d'amortissement initial
  | 'credit_statement'  // PDF relevé mensuel crédit (Cofidis, Sofinco…)
  | 'bank_statement'    // analyse bank LBP via Claude
  | 'suggestion';       // suggestion Claude (recurringExpenses) auto-créée

/**
 * Patch partiel appliqué à un Loan via `mergeLoanPatch`. Tous les champs
 * sont optionnels — seul ce qui est défini est candidat à mise à jour.
 * `mergeLoanPatch` filtre selon la source quel champ peut écrire.
 */
export interface LoanPatch {
  creditor?: string;
  contractRef?: string;
  rumRefs?: string[];                  // additif (union, pas écrase)
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;
  monthlyPayment?: number;
  maxAmount?: number;
  usedAmount?: number;
  taeg?: number | null;
  amortizationSchedule?: AmortizationLine[];
  lastStatementSnapshot?: LoanStatementSnapshot;
}

/**
 * Signaux disponibles pour identifier un Loan existant à partir d'une
 * source d'import (relevé crédit, tableau d'amortissement, suggestion
 * Claude). Tous optionnels — la méthode `findExistingLoan` essaie chaque
 * signal par ordre de spécificité décroissante.
 */
export interface MatchSignals {
  contractRef?: string | null;       // numéro de contrat (ou accountNumber côté credit_statement)
  rumNumber?: string | null;         // RUM SEPA
  creditor?: string | null;          // organisme prêteur
  monthlyAmount?: number | null;     // mensualité (pour matching heuristique)
  description?: string | null;       // libellé de transaction (pour matchPattern regex)
}

/**
 * Résultat d'un match : le Loan trouvé, le niveau de confiance (high/medium/low)
 * et la raison textuelle (debug + UI).
 */
export interface MatchResult {
  loan: Loan;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Payload extrait par AmortizationService.analyzeAmortization() — utilisé
 * par LoansService.applyAmortizationSchedule pour pré-remplir un Loan.
 */
export interface AmortizationSnapshotInput {
  creditor: string;
  initialPrincipal: number;
  monthlyPayment: number;
  startDate: string;
  endDate: string;
  taeg?: number | null;
  schedule: AmortizationLine[];
}

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
    private readonly storage: StorageService,
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

  /**
   * Ajoute une occurrence à un loan, avec dédup multi-niveau :
   *
   * 1. Dédup stricte sur (statementId, transactionId) — empêche un même
   *    relevé de réinjecter la même transaction au re-scan.
   * 2. Dédup mensuelle sur (loanId, YYYY-MM) — empêche le double-comptage
   *    quand la mensualité apparaît dans un relevé compte ET un relevé
   *    crédit (typique : 1-3 jours d'écart). La nouvelle occurrence
   *    remplace l'existante uniquement si elle a une priorité de source
   *    supérieure : credit_statement > bank_statement > manual.
   */
  async addOccurrence(
    id: string,
    occ: {
      statementId: string;
      date: string;
      amount: number;
      transactionId: string | null;
      description?: string;
      source?: LoanOccurrenceSource;
    },
  ): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];
    const source: LoanOccurrenceSource = occ.source ?? 'bank_statement';

    // Niveau 1 : dédup stricte (statementId, transactionId)
    const dupKey = (o: LoanOccurrence) => `${o.statementId}|${o.transactionId ?? ''}`;
    const newKey = `${occ.statementId}|${occ.transactionId ?? ''}`;
    if (loan.occurrencesDetected.some((o) => dupKey(o) === newKey)) {
      this.logger.debug(`Skipping exact duplicate occurrence on loan ${id} (${newKey})`);
      return loan;
    }

    // Niveau 2 : dédup mensuelle (YYYY-MM, loanId) — gère les décalages temporels
    const monthOf = (d: string) => d.slice(0, 7); // 'YYYY-MM-DD' → 'YYYY-MM'
    const newMonth = monthOf(occ.date);
    const sourcePriority = (s: LoanOccurrenceSource | undefined): number => {
      // Plus haut = plus prioritaire. credit_statement = source canonique
      // (émis par l'organisme prêteur), donc remplace bank_statement et manual.
      if (s === 'credit_statement') return 3;
      if (s === 'bank_statement' || s === undefined) return 2; // undefined = legacy = bank
      return 1; // manual
    };
    const existingSameMonth = loan.occurrencesDetected.find(
      (o) => monthOf(o.date) === newMonth,
    );
    if (existingSameMonth) {
      const existingPrio = sourcePriority(existingSameMonth.source);
      const newPrio = sourcePriority(source);
      if (newPrio <= existingPrio) {
        this.logger.debug(
          `Skipping occurrence on loan ${id} for ${newMonth} — existing ${existingSameMonth.source ?? 'bank'} has equal/higher priority`,
        );
        return loan;
      }
      // Nouvelle source plus prioritaire → remplacement
      this.logger.log(
        `Replacing ${existingSameMonth.source ?? 'bank'} occurrence with ${source} on loan ${id} for ${newMonth}`,
      );
      loan.occurrencesDetected = loan.occurrencesDetected.filter(
        (o) => o.id !== existingSameMonth.id,
      );
    }

    const newOcc: LoanOccurrence = { id: randomUUID(), ...occ, source };
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
   * (PDF analysé par Claude). Délégue à `mergeLoanPatch` avec source
   * 'credit_statement' qui applique les règles de priorité par champ.
   * Stocke le snapshot extrait dans `lastStatementSnapshot`.
   */
  async applyStatementSnapshot(
    id: string,
    extracted: CreditStatementSnapshotInput,
  ): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];

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

    // Build patch — n'inclure que les champs définis (sinon mergeLoanPatch les
    // ignore). Pour un revolving on update maxAmount + usedAmount ; pour un
    // classic on update endDate uniquement (les autres champs revolving-only
    // sont irrelevant).
    const patch: LoanPatch = {
      monthlyPayment: extracted.monthlyPayment > 0 ? extracted.monthlyPayment : undefined,
      creditor: extracted.creditor || undefined,
      taeg: extracted.taeg ?? undefined,
      lastStatementSnapshot: snapshot,
    };
    if (extracted.creditType === 'revolving') {
      if (extracted.maxAmount != null && extracted.maxAmount > 0) {
        patch.maxAmount = extracted.maxAmount;
      }
      patch.usedAmount = Math.max(0, extracted.currentBalance);
    } else {
      // classic : on peut renseigner endDate si extraite ; idem startDate
      // (qui était bug avant — credit_statement peut écrire startDate si vide)
      if (extracted.endDate) patch.endDate = extracted.endDate;
    }

    LoansService.mergeLoanPatch(loan, patch, 'credit_statement');
    await this.persist(all);
    return loan;
  }

  /**
   * MERGE LOAN PATCH — applique un patch partiel à un Loan en respectant
   * les règles de priorité par champ et par source.
   *
   * Règles de priorité (du plus fort au plus faible) :
   *   user > amortization > credit_statement > bank_statement > suggestion
   *
   * Pour chaque champ du patch :
   *   - certains champs ne peuvent être écrits que par certaines sources
   *   - certains champs ne sont écrits que si l'existant est vide (preserve user)
   *   - rumRefs[] est additif (union, pas écrasement)
   *   - lastStatementSnapshot ne s'écrit que depuis credit_statement
   *   - amortizationSchedule ne s'écrit que depuis amortization
   *
   * Mute le loan en place et update `updatedAt`. NE PERSISTE PAS — le caller
   * doit appeler `persist()` après. C'est intentionnel pour permettre le
   * batching de plusieurs mutations dans une seule écriture.
   */
  static mergeLoanPatch(loan: Loan, patch: LoanPatch, source: LoanPatchSource): void {
    const isUser = source === 'user';
    const isAmortization = source === 'amortization';
    const isCreditStatement = source === 'credit_statement';
    const isAuto = !isUser; // toute source non-user est automatique

    // creditor : preserve si déjà set (sauf si user override). Auto-fill si vide.
    if (patch.creditor !== undefined) {
      if (isUser) {
        loan.creditor = patch.creditor || undefined;
      } else if (!loan.creditor) {
        loan.creditor = patch.creditor;
      }
    }

    // contractRef : preserve user-set, auto-fill si vide
    if (patch.contractRef !== undefined) {
      if (isUser) {
        loan.contractRef = patch.contractRef || undefined;
      } else if (!loan.contractRef && patch.contractRef) {
        loan.contractRef = patch.contractRef;
      }
    }

    // rumRefs : ADDITIF (union dédup-normalisée)
    if (patch.rumRefs && patch.rumRefs.length > 0) {
      const existing = loan.rumRefs ?? [];
      const merged = [...existing];
      for (const r of patch.rumRefs) {
        const known = merged.some((e) => LoansService.refsMatch(e, r));
        if (!known) merged.push(r);
      }
      loan.rumRefs = merged.length > 0 ? merged : undefined;
    }

    // startDate : amortization gagne (source canonique). credit_statement
    // peut auto-fill si vide. user peut tout écraser.
    if (patch.startDate !== undefined) {
      if (isUser || isAmortization) {
        loan.startDate = patch.startDate;
      } else if (!loan.startDate && patch.startDate) {
        loan.startDate = patch.startDate;
      }
    }

    // endDate : amortization gagne, credit_statement auto-update OK, user override
    if (patch.endDate !== undefined) {
      if (isUser || isAmortization || isCreditStatement) {
        loan.endDate = patch.endDate;
      }
    }

    // initialPrincipal : amortization-only (sauf user)
    if (patch.initialPrincipal !== undefined) {
      if (isUser || isAmortization) {
        loan.initialPrincipal = patch.initialPrincipal;
      }
    }

    // monthlyPayment : toute source peut update
    if (patch.monthlyPayment !== undefined && Number.isFinite(patch.monthlyPayment) && patch.monthlyPayment > 0) {
      loan.monthlyPayment = patch.monthlyPayment;
    }

    // maxAmount : credit_statement-only (revolving) sauf user
    if (patch.maxAmount !== undefined) {
      if (isUser || isCreditStatement) {
        loan.maxAmount = patch.maxAmount;
      }
    }

    // usedAmount : credit_statement-only (canonical) sauf user. amortization
    // n'a aucune autorité sur usedAmount d'un revolving.
    if (patch.usedAmount !== undefined) {
      if (isUser || isCreditStatement) {
        loan.usedAmount = patch.usedAmount;
      }
    }

    // taeg : amortization > credit_statement, user peut override
    if (patch.taeg !== undefined) {
      if (isUser || isAmortization) {
        loan.taeg = patch.taeg;
      } else if (isCreditStatement && (loan.taeg == null)) {
        // credit_statement : auto-fill si vide
        loan.taeg = patch.taeg;
      }
    }

    // amortizationSchedule : amortization-only
    if (patch.amortizationSchedule !== undefined) {
      if (isUser || isAmortization) {
        loan.amortizationSchedule = patch.amortizationSchedule;
      }
    }

    // lastStatementSnapshot : credit_statement-only
    if (patch.lastStatementSnapshot !== undefined && isCreditStatement) {
      loan.lastStatementSnapshot = patch.lastStatementSnapshot;
    }

    if (isAuto || isUser) {
      loan.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Normalise une référence (contract / RUM) pour comparaison robuste :
   * lowercase + strip espaces et tirets. Les références sont parfois
   * formatées "1234 5678 9012" ou "ABC-DEF-123" sur les PDFs.
   */
  private static normalizeRef(s: string): string {
    return s.toLowerCase().replace(/[\s-]/g, '');
  }

  /**
   * Match tolérant entre deux références (substring dans les deux sens),
   * pour gérer les abréviations côté organisme.
   */
  private static refsMatch(a: string, b: string): boolean {
    const na = LoansService.normalizeRef(a);
    const nb = LoansService.normalizeRef(b);
    if (na.length < 4 || nb.length < 4) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  /**
   * @deprecated utiliser findExistingLoan/findByIdentifiers — gardée pour
   * rétro-compat sur d'éventuels appels externes (tests, scripts).
   */
  async findByAccountNumber(accountNumber: string): Promise<Loan | null> {
    return this.findByIdentifiers({ accountNumber });
  }

  /**
   * Wrapper rétro-compat : retourne juste le Loan ou null sans la
   * confidence ni la raison du match. Délégué à findExistingLoan.
   */
  async findByIdentifiers(args: {
    accountNumber?: string | null;
    rumNumber?: string | null;
  }): Promise<Loan | null> {
    const result = await this.findExistingLoan({
      contractRef: args.accountNumber,
      rumNumber: args.rumNumber,
    });
    return result?.loan ?? null;
  }

  /**
   * MATCHER UNIFIÉ — point d'entrée unique pour identifier un Loan
   * existant à partir d'un set de signaux (extrait de relevé crédit,
   * tableau d'amortissement, ou suggestion bank statement Claude).
   *
   * Scoring confidence (descend dès qu'un match est trouvé) :
   *   high   : contractRef match tolérant (lowercase + strip espaces/tirets, substring)
   *   high   : rumNumber match dans rumRefs[] (même normalisation)
   *   medium : creditor exact (case-insensitive trim) ET monthlyAmount ±5%
   *   low    : description matche loan.matchPattern regex (et pas de meilleur match)
   *
   * Utilisé par tous les chemins (importCreditStatementsAuto,
   * importAmortization, autoCreateLoansFromSuggestions) via
   * ImportOrchestratorService pour éviter les doublons.
   */
  async findExistingLoan(signals: MatchSignals): Promise<MatchResult | null> {
    const all = await this.getAll();
    if (all.length === 0) return null;

    // 1. contractRef → high
    if (signals.contractRef) {
      const ref = signals.contractRef;
      const hit = all.find((l) => l.contractRef && LoansService.refsMatch(l.contractRef, ref));
      if (hit) return { loan: hit, confidence: 'high', reason: 'contractRef match' };
    }

    // 2. rumNumber → high
    if (signals.rumNumber) {
      const rum = signals.rumNumber;
      const hit = all.find((l) =>
        (l.rumRefs ?? []).some((r) => LoansService.refsMatch(r, rum)),
      );
      if (hit) return { loan: hit, confidence: 'high', reason: 'rumNumber match' };
    }

    // 3. creditor exact + monthlyAmount ±5% → medium
    if (signals.creditor && signals.monthlyAmount && signals.monthlyAmount > 0) {
      const cred = signals.creditor.toLowerCase().trim();
      const target = signals.monthlyAmount;
      const tol = Math.max(target * 0.05, 0.5); // au moins 0.50€ de marge
      const hit = all.find((l) => {
        const lcred = (l.creditor ?? '').toLowerCase().trim();
        if (lcred !== cred) return false;
        return Math.abs(l.monthlyPayment - target) <= tol;
      });
      if (hit) return { loan: hit, confidence: 'medium', reason: 'creditor + monthlyAmount ±5%' };
    }

    // 4. description regex match → low
    if (signals.description) {
      const desc = signals.description;
      const hit = all.find((l) => {
        if (!l.matchPattern) return false;
        try {
          return new RegExp(l.matchPattern, 'i').test(desc);
        } catch {
          return false;
        }
      });
      if (hit) return { loan: hit, confidence: 'low', reason: 'description regex match' };
    }

    return null;
  }

  /**
   * Détecte les Loans probablement créés à tort par un pattern pay-in-N
   * (paiements échelonnés 2-4 fois — Cofidis 4X CB, Alma 4X, Klarna 3X…).
   * Heuristique :
   *   1. name OU matchPattern matche PAY_IN_N_PATTERN → suspect
   *   2. OU : ≤4 occurrences distinctes ET sur ≤4 mois consécutifs ET
   *      pas d'occurrence depuis ≥60 jours
   *
   * Retourne la liste des candidats avec une raison (pour UI). Aucune
   * suppression — la décision est manuelle (cleanupSuspiciousLoans).
   */
  async getSuspiciousLoans(now?: string): Promise<Array<{
    id: string;
    name: string;
    creditor?: string;
    monthlyPayment: number;
    occurrencesCount: number;
    lastOccurrenceDate: string | null;
    reason: string;
  }>> {
    const today = now ?? new Date().toISOString().slice(0, 10);
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    const all = await this.getAll();
    const suspicious: Awaited<ReturnType<LoansService['getSuspiciousLoans']>> = [];

    // Pour le critère 3 : récupérer le dernier statement (mois le plus récent)
    let lastStmtMonth: string | null = null;
    let lastStmtIds = new Set<string>();
    try {
      const allStmts = await this.storage.getAllStatements();
      if (allStmts.length > 0) {
        const sortedStmts = [...allStmts].sort((a, b) => {
          const ka = `${a.year}-${String(a.month).padStart(2, '0')}`;
          const kb = `${b.year}-${String(b.month).padStart(2, '0')}`;
          return kb.localeCompare(ka); // desc
        });
        const lastStmt = sortedStmts[0];
        lastStmtMonth = `${lastStmt.year}-${String(lastStmt.month).padStart(2, '0')}`;
        lastStmtIds = new Set([lastStmt.id]);
      }
    } catch {
      // Sans statement, on skip le critère 3
    }

    for (const loan of all) {
      // Skip les loans déjà modélisés comme installment (légitimes — c'est
      // exactement le pattern qu'on veut détecter, pas un faux positif).
      if (LoansService.getLoanKind(loan) === 'installment') continue;
      // Critère 1 : regex pay-in-N sur name ou matchPattern
      const nameMatch = PAY_IN_N_PATTERN.test(loan.name);
      const patternMatch = loan.matchPattern && PAY_IN_N_PATTERN.test(loan.matchPattern);
      if (nameMatch || patternMatch) {
        const lastDate = LoansService.lastOccurrenceDate(loan);
        suspicious.push({
          id: loan.id,
          name: loan.name,
          creditor: loan.creditor,
          monthlyPayment: loan.monthlyPayment,
          occurrencesCount: loan.occurrencesDetected.length,
          lastOccurrenceDate: lastDate,
          reason: nameMatch ? `Nom matche pattern pay-in-N: "${loan.name}"` : `matchPattern matche pay-in-N`,
        });
        continue;
      }

      // Critère 2 : pattern d'occurrences court + arrêté
      const occCount = loan.occurrencesDetected.length;
      if (occCount === 0 || occCount > 4) continue;

      // Mois distincts couverts
      const months = new Set<string>(loan.occurrencesDetected.map((o) => o.date.slice(0, 7)));
      if (months.size > 4) continue;

      // Mois consécutifs ?
      const sortedMonths = Array.from(months).sort();
      const firstM = sortedMonths[0];
      const lastM = sortedMonths[sortedMonths.length - 1];
      const monthsSpan =
        (Number(lastM.slice(0, 4)) - Number(firstM.slice(0, 4))) * 12 +
        (Number(lastM.slice(5, 7)) - Number(firstM.slice(5, 7))) + 1;
      if (monthsSpan > 4) continue; // span > 4 mois → pas un pay-in-4

      // Pas d'occurrence depuis ≥ 60 jours ?
      const lastDate = LoansService.lastOccurrenceDate(loan);
      if (!lastDate) continue;
      const daysSinceLast = (todayMs - new Date(lastDate + 'T00:00:00Z').getTime()) / (24 * 3600 * 1000);
      if (daysSinceLast < 60) continue;

      suspicious.push({
        id: loan.id,
        name: loan.name,
        creditor: loan.creditor,
        monthlyPayment: loan.monthlyPayment,
        occurrencesCount: occCount,
        lastOccurrenceDate: lastDate,
        reason: `${occCount} occurrence(s) sur ${monthsSpan} mois, dernière il y a ${Math.round(daysSinceLast)}j — typique pay-in-N`,
      });
    }

    // Critère 3 : invariant "absent du dernier relevé"
    //
    // Un crédit actif (classic/revolving) avec startDate ≤ date du dernier
    // relevé DOIT avoir une occurrence dans le dernier relevé. Sinon :
    //   - soit le crédit est terminé (devrait être inactive)
    //   - soit c'est un doublon (créé à tort)
    //   - soit c'est un faux positif (startDate récent post-relevé) — exclu
    //
    // Ne s'applique qu'aux loans actifs ; les loans pas encore poussés
    // dans suspicious[] (pour éviter doublons d'entrée).
    if (lastStmtMonth) {
      const alreadySuspectIds = new Set(suspicious.map((s) => s.id));
      for (const loan of all) {
        if (!loan.isActive) continue;
        if (alreadySuspectIds.has(loan.id)) continue;
        if (LoansService.getLoanKind(loan) === 'installment') continue;
        // startDate posterieur au dernier relevé → faux positif (loan trop frais)
        if (loan.startDate) {
          const startMonth = loan.startDate.slice(0, 7);
          if (startMonth > lastStmtMonth) continue;
        }
        // Le loan a-t-il une occurrence dans le dernier relevé ?
        const seenInLast = loan.occurrencesDetected.some((o) => {
          if (lastStmtIds.has(o.statementId)) return true;
          return o.date.slice(0, 7) === lastStmtMonth;
        });
        if (seenInLast) continue;
        const lastOccDate = LoansService.lastOccurrenceDate(loan);
        suspicious.push({
          id: loan.id,
          name: loan.name,
          creditor: loan.creditor,
          monthlyPayment: loan.monthlyPayment,
          occurrencesCount: loan.occurrencesDetected.length,
          lastOccurrenceDate: lastOccDate,
          reason: `Absent du dernier relevé (${lastStmtMonth}) — invariant "1 débit/mois max" violé : soit terminé, soit doublon`,
        });
      }
    }

    return suspicious;
  }

  private static lastOccurrenceDate(loan: Loan): string | null {
    if (loan.occurrencesDetected.length === 0) return null;
    return loan.occurrencesDetected.reduce(
      (max, o) => (o.date > max ? o.date : max),
      loan.occurrencesDetected[0].date,
    );
  }

  /**
   * Supprime en bulk les loans marqués comme suspects par l'utilisateur
   * (validation manuelle via UI). Aucune heuristique automatique — l'user
   * fournit explicitement les IDs à supprimer.
   */
  async cleanupSuspiciousLoans(loanIds: string[]): Promise<{ deletedCount: number }> {
    if (!loanIds || loanIds.length === 0) {
      throw new BadRequestException('Aucun loanId fourni');
    }
    const all = await this.getAll();
    const idSet = new Set(loanIds);
    const filtered = all.filter((l) => !idSet.has(l.id));
    const deletedCount = all.length - filtered.length;
    if (deletedCount === 0) {
      throw new NotFoundException('Aucun des IDs fournis ne correspond à un loan existant');
    }
    await this.persist(filtered);
    this.logger.log(`Cleanup pay-in-N : ${deletedCount} loan(s) supprimé(s)`);
    return { deletedCount };
  }

  /**
   * Convertit un Loan existant (typiquement classic créé à tort) en
   * `kind='installment'`. Reconstruit `installmentSchedule[]` depuis les
   * `occurrencesDetected` triées : chaque occurrence devient une échéance
   * `paid:true`. Désactive le loan si toutes les échéances sont passées
   * (paiement N fois terminé).
   *
   * Use-case : modal Suspects propose "Convertir en paiement échelonné"
   * pour les loans classic ≤4 occurrences arrêtés ≥60j.
   */
  async convertToInstallment(loanId: string): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === loanId);
    if (idx === -1) throw new NotFoundException(`Crédit ${loanId} introuvable`);
    const loan = all[idx];
    const occurrences = [...(loan.occurrencesDetected ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (occurrences.length === 0) {
      throw new BadRequestException(
        `Loan ${loanId} sans occurrence — impossible de reconstruire un échéancier`,
      );
    }
    const schedule: InstallmentLine[] = occurrences.map((o) => ({
      dueDate: o.date,
      amount: Math.abs(o.amount),
      paid: true,
      paidOccurrenceId: o.statementId ?? undefined,
    }));
    loan.kind = 'installment';
    loan.installmentSchedule = schedule;
    loan.installmentSignatureDate = loan.installmentSignatureDate ?? schedule[0].dueDate;
    loan.installmentMerchant = loan.installmentMerchant ?? loan.creditor ?? undefined;
    // Si toutes les échéances sont passées, le paiement N fois est terminé → désactive
    const today = new Date().toISOString().slice(0, 10);
    const allPast = schedule.every((s) => s.dueDate <= today);
    if (allPast) {
      loan.isActive = false;
      loan.endDate = schedule[schedule.length - 1].dueDate;
    }
    loan.updatedAt = new Date().toISOString();
    await this.persist(all);
    this.logger.log(
      `Converted loan ${loanId} → installment (${schedule.length} échéances, active=${loan.isActive})`,
    );
    return loan;
  }

  /**
   * Retourne le kind canonique d'un Loan : explicit (`loan.kind`) sinon
   * déduit depuis `type` (rétro-compat pré-APEX 05). Pas de mutation.
   */
  static getLoanKind(loan: Pick<Loan, 'kind' | 'type'>): LoanKind {
    return loan.kind ?? loan.type; // type='classic'|'revolving' → mêmes valeurs valides
  }

  /**
   * Évalue la santé des données d'un Loan :
   *   - 'complete' : tableau d'amortissement présent OU statement récent (≤60j),
   *                  ET ≥3 occurrences sur les 6 derniers mois
   *   - 'partial'  : 1-2 critères manquants
   *   - 'gap'      : 0 statement récent ET ≤1 occurrence
   *
   * Permet à l'user d'identifier visuellement les crédits qui manquent de
   * données pour un suivi fiable.
   */
  static getLoanHealth(loan: Loan, now?: string): 'complete' | 'partial' | 'gap' {
    const today = now ?? new Date().toISOString().slice(0, 10);
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    const kind = LoansService.getLoanKind(loan);

    // Cas spécial installment : santé = toutes les past dueDates paid ?
    if (kind === 'installment') {
      const schedule = loan.installmentSchedule ?? [];
      if (schedule.length === 0) return 'gap';
      const past = schedule.filter((l) => l.dueDate <= today);
      if (past.length === 0) {
        // Aucune échéance encore due → schedule présent mais en attente
        return 'complete';
      }
      const paid = past.filter((l) => l.paid).length;
      if (paid === past.length) return 'complete';
      // 0 paid n'est PAS forcément un trou : si aucun relevé bancaire ne
      // couvre les dueDates, le matcher n'a rien pu vérifier. On reste sur
      // 'partial' (jaune) pour signaler "à compléter via import relevé"
      // plutôt que 'gap' (rouge) qui suggère un problème.
      return 'partial';
    }

    // Classic / revolving : heuristique standard
    const hasAmortization = (loan.amortizationSchedule?.length ?? 0) > 0;
    const lastSnapshotDate = loan.lastStatementSnapshot?.date ?? null;
    const recentSnapshot = lastSnapshotDate
      ? (todayMs - new Date(lastSnapshotDate).getTime()) <= 60 * 24 * 3600 * 1000
      : false;

    const sixMonthsAgo = new Date(todayMs - 180 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const occurrencesRecent = (loan.occurrencesDetected ?? []).filter(
      (o) => o.date >= sixMonthsAgo && o.date <= today,
    ).length;

    const dataPresent = hasAmortization || recentSnapshot;
    const enoughOccurrences = occurrencesRecent >= 3;

    if (dataPresent && enoughOccurrences) return 'complete';
    if (!dataPresent && occurrencesRecent <= 1) return 'gap';
    return 'partial';
  }

  /**
   * Marque la ligne `installmentSchedule[index]` d'un loan kind='installment'
   * comme `paid: true` avec le `paidOccurrenceId` qui a satisfait l'échéance.
   * Idempotent — re-marquer une ligne déjà paid est no-op.
   */
  async markInstallmentPaid(loanId: string, lineIndex: number, paidOccurrenceId?: string): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === loanId);
    if (idx === -1) throw new NotFoundException(`Crédit ${loanId} introuvable`);
    const loan = all[idx];
    if (!loan.installmentSchedule || lineIndex < 0 || lineIndex >= loan.installmentSchedule.length) {
      throw new BadRequestException(`installmentSchedule[${lineIndex}] introuvable sur loan ${loanId}`);
    }
    if (loan.installmentSchedule[lineIndex].paid) {
      return loan; // idempotent
    }
    loan.installmentSchedule[lineIndex] = {
      ...loan.installmentSchedule[lineIndex],
      paid: true,
      paidOccurrenceId,
    };
    loan.updatedAt = new Date().toISOString();
    await this.persist(all);
    return loan;
  }

  /**
   * Ajoute un RUM à la liste rumRefs[] d'un loan si pas déjà présent
   * (comparaison normalisée). No-op si le RUM est déjà connu.
   * Utilisé après matching réussi quand le relevé courant porte un
   * nouveau RUM (renouvellement de mandat SEPA).
   */
  async attachRumRef(loanId: string, rum: string): Promise<Loan> {
    const trimmed = rum.trim();
    if (!trimmed) throw new BadRequestException('RUM vide');
    const all = await this.getAll();
    const idx = all.findIndex((x) => x.id === loanId);
    if (idx === -1) throw new NotFoundException(`Crédit ${loanId} introuvable`);
    const existing = all[idx].rumRefs ?? [];
    const alreadyKnown = existing.some((r) => LoansService.refsMatch(r, trimmed));
    if (alreadyKnown) return all[idx];
    all[idx] = {
      ...all[idx],
      rumRefs: [...existing, trimmed],
      updatedAt: new Date().toISOString(),
    };
    await this.persist(all);
    this.logger.log(`Attached RUM "${trimmed}" to loan ${loanId}`);
    return all[idx];
  }

  /**
   * Applique un tableau d'amortissement extrait depuis un PDF (Claude) à un
   * Loan classique : update partiel des champs canoniques (initialPrincipal,
   * monthlyPayment, startDate, endDate) + assignation du schedule[]. Ne
   * touche pas à `name`, `category`, `matchPattern`, `occurrencesDetected`,
   * `createdAt`. Force `type` à `'classic'` (les revolving n'ont pas de
   * tableau d'amortissement par construction).
   */
  async applyAmortizationSchedule(
    id: string,
    extracted: AmortizationSnapshotInput,
  ): Promise<Loan> {
    if (!extracted.schedule || extracted.schedule.length === 0) {
      throw new BadRequestException('Schedule vide — extraction PDF échouée');
    }
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];

    if (loan.type !== 'classic') {
      throw new BadRequestException(
        `Le tableau d'amortissement ne s'applique qu'aux crédits classiques (type=classic). Crédit ${id} est ${loan.type}.`,
      );
    }

    // Délégué à mergeLoanPatch — l'amortization est la source la plus
    // canonique pour : initialPrincipal, monthlyPayment, startDate, endDate,
    // schedule[], taeg.
    const sortedSchedule = [...extracted.schedule].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    LoansService.mergeLoanPatch(
      loan,
      {
        creditor: extracted.creditor || undefined,
        initialPrincipal: extracted.initialPrincipal,
        monthlyPayment: extracted.monthlyPayment,
        startDate: extracted.startDate,
        endDate: extracted.endDate,
        taeg: extracted.taeg ?? undefined,
        amortizationSchedule: sortedSchedule,
      },
      'amortization',
    );

    await this.persist(all);
    this.logger.log(
      `Applied amortization schedule to ${loan.id}: ${(loan.amortizationSchedule ?? []).length} lines`,
    );
    return loan;
  }

  /**
   * Détecte les doublons probables dans la base loans.
   * Heuristique : même créancier (normalisé) + même type + monthlyPayment ±5% +
   * identifiants (contractRef / rumRefs) qui ne se contredisent PAS.
   *
   * Retourne des "groupes" de candidats où le user choisira lequel conserver
   * comme canonical. Pas d'auto-merge — décision humaine (les faux positifs
   * pourraient écraser de vrais crédits distincts).
   */
  async detectDuplicates(): Promise<DuplicateGroup[]> {
    const all = await this.getAll();
    const groups = new Map<string, Loan[]>();

    // Groupage par créancier+type — clé normalisée
    for (const loan of all) {
      const creditor = (loan.creditor || '').trim().toLowerCase();
      if (!creditor) continue; // sans créancier on ne dédupe pas
      const key = `${creditor}::${loan.type}`;
      const list = groups.get(key) ?? [];
      list.push(loan);
      groups.set(key, list);
    }

    const results: DuplicateGroup[] = [];
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      // Pour chaque paire dans le groupe, on construit des sous-groupes
      // de doublons candidats.
      const visited = new Set<string>();
      for (let i = 0; i < list.length; i++) {
        if (visited.has(list[i].id)) continue;
        const cluster: Loan[] = [list[i]];
        for (let j = i + 1; j < list.length; j++) {
          if (visited.has(list[j].id)) continue;
          if (LoansService.areLikelyDuplicates(list[i], list[j])) {
            cluster.push(list[j]);
            visited.add(list[j].id);
          }
        }
        if (cluster.length >= 2) {
          visited.add(list[i].id);
          results.push({
            creditor: cluster[0].creditor!,
            type: cluster[0].type,
            loans: cluster.map((l) => ({
              id: l.id,
              name: l.name,
              monthlyPayment: l.monthlyPayment,
              contractRef: l.contractRef,
              rumRefs: l.rumRefs,
              maxAmount: l.maxAmount,
              usedAmount: l.usedAmount,
              startDate: l.startDate,
              endDate: l.endDate,
              occurrencesCount: l.occurrencesDetected.length,
              isActive: l.isActive,
              createdAt: l.createdAt,
            })),
            reasons: LoansService.duplicateReasons(cluster),
          });
        }
      }
    }
    return results;
  }

  /**
   * Heuristique : 2 loans sont probablement le même crédit si :
   * - même créancier+type (déjà filtré côté caller)
   * - leurs identifiants ne se contredisent PAS franchement
   * - ET au moins UN des signaux suivants :
   *   (a) mensualité dans une fenêtre de ±5%
   *   (b) **invariant 1 débit/mois max** : ils partagent ≥1 mois
   *       d'occurrence calendaire — un crédit étant débité au plus 1 fois
   *       par mois, 2 loans actifs avec une occurrence dans le même mois
   *       sont forcément le même crédit (ou un faux positif).
   */
  private static areLikelyDuplicates(a: Loan, b: Loan): boolean {
    if (a.id === b.id) return false;

    // Si les deux ont un contractRef et qu'ils sont franchement différents,
    // ce sont des crédits distincts.
    const refA = a.contractRef?.trim();
    const refB = b.contractRef?.trim();
    if (refA && refB && refA.length >= 4 && refB.length >= 4) {
      if (!LoansService.refsMatch(refA, refB)) return false;
    }

    // Signal (a) : mensualité ±5%
    const pa = a.monthlyPayment;
    const pb = b.monthlyPayment;
    let monthlyClose = false;
    if (pa > 0 && pb > 0) {
      const tolerance = Math.max(pa, pb) * 0.05;
      monthlyClose = Math.abs(pa - pb) <= tolerance;
    }

    // Signal (b) : invariant — partage d'au moins un mois d'occurrence
    const monthsA = new Set(a.occurrencesDetected.map((o) => o.date.slice(0, 7)));
    const monthsB = new Set(b.occurrencesDetected.map((o) => o.date.slice(0, 7)));
    const sharesMonth = [...monthsA].some((m) => monthsB.has(m));

    return monthlyClose || sharesMonth;
  }

  private static duplicateReasons(cluster: Loan[]): string[] {
    const reasons: string[] = [];
    const creditor = cluster[0].creditor;
    if (creditor) reasons.push(`Même créancier : ${creditor}`);
    const payments = cluster.map((l) => l.monthlyPayment);
    const minP = Math.min(...payments);
    const maxP = Math.max(...payments);
    if (Math.abs(maxP - minP) < 0.01) {
      reasons.push(`Mensualité identique : ${minP.toFixed(2)} €`);
    } else {
      reasons.push(`Mensualités proches : ${payments.map((p) => p.toFixed(2) + ' €').join(' / ')}`);
    }
    const withContract = cluster.filter((l) => l.contractRef);
    const withRum = cluster.filter((l) => l.rumRefs && l.rumRefs.length > 0);
    if (withContract.length > 0 && withRum.length > 0 && withContract[0].id !== withRum[0].id) {
      reasons.push("Identifiants partagés : l'un porte un n° de contrat, l'autre un RUM SEPA — pattern typique de doublon RUM.");
    }
    // Invariant : mois d'occurrence partagés
    const monthsByLoan = cluster.map(
      (l) => new Set(l.occurrencesDetected.map((o) => o.date.slice(0, 7))),
    );
    const sharedMonths = new Set<string>();
    for (let i = 0; i < monthsByLoan.length; i++) {
      for (let j = i + 1; j < monthsByLoan.length; j++) {
        for (const m of monthsByLoan[i]) {
          if (monthsByLoan[j].has(m)) sharedMonths.add(m);
        }
      }
    }
    if (sharedMonths.size > 0) {
      const list = [...sharedMonths].sort().join(', ');
      reasons.push(
        `Invariant violé "1 débit/mois max" : occurrences dans le(s) même(s) mois (${list}) — forcément le même crédit.`,
      );
    }
    return reasons;
  }

  /**
   * Fusionne plusieurs loans dans un canonical. Migre les `occurrencesDetected`
   * (déduplication par `(statementId, transactionId)`), union des `rumRefs[]`,
   * adoption du `contractRef` du dup si canonical n'en a pas, puis suppression
   * des duplicates.
   *
   * NB : `usedAmount` du canonical est PRESERVÉ (on suppose qu'il est à jour),
   * `maxAmount` aussi. Les statement snapshots des dups ne sont pas migrés
   * (un seul snapshot conservé = celui du canonical).
   */
  async mergeDuplicates(canonicalId: string, duplicateIds: string[]): Promise<Loan> {
    if (!duplicateIds || duplicateIds.length === 0) {
      throw new BadRequestException('Aucun duplicate à merger');
    }
    if (duplicateIds.includes(canonicalId)) {
      throw new BadRequestException('Le canonical ne peut pas figurer dans la liste des duplicates');
    }
    const all = await this.getAll();
    const canonical = all.find((l) => l.id === canonicalId);
    if (!canonical) throw new NotFoundException(`Canonical ${canonicalId} introuvable`);

    const dups: Loan[] = [];
    for (const dupId of duplicateIds) {
      const dup = all.find((l) => l.id === dupId);
      if (!dup) throw new NotFoundException(`Duplicate ${dupId} introuvable`);
      if (dup.creditor?.toLowerCase().trim() !== canonical.creditor?.toLowerCase().trim()) {
        throw new BadRequestException(
          `Refus de merger : ${dup.id} a un créancier différent de ${canonical.id}`,
        );
      }
      if (dup.type !== canonical.type) {
        throw new BadRequestException(`Refus de merger : types différents`);
      }
      dups.push(dup);
    }

    // Adoption du contractRef du premier dup qui en a un, si canonical n'en a pas
    if (!canonical.contractRef) {
      const dupWithRef = dups.find((d) => d.contractRef);
      if (dupWithRef?.contractRef) {
        canonical.contractRef = dupWithRef.contractRef;
      }
    }

    // Union des rumRefs[] (déduplication via refsMatch normalisée)
    const allRums = new Set<string>(canonical.rumRefs ?? []);
    for (const d of dups) {
      for (const r of d.rumRefs ?? []) {
        const known = [...allRums].some((existing) => LoansService.refsMatch(existing, r));
        if (!known) allRums.add(r);
      }
    }
    canonical.rumRefs = allRums.size > 0 ? [...allRums] : undefined;

    // Migration des occurrencesDetected — dédup par (statementId, transactionId)
    const seenKey = new Set<string>(
      canonical.occurrencesDetected.map((o) => `${o.statementId}::${o.transactionId ?? '_'}`),
    );
    for (const d of dups) {
      for (const occ of d.occurrencesDetected) {
        const key = `${occ.statementId}::${occ.transactionId ?? '_'}`;
        if (!seenKey.has(key)) {
          canonical.occurrencesDetected.push(occ);
          seenKey.add(key);
        }
      }
    }
    // Re-tri chrono
    canonical.occurrencesDetected.sort((a, b) => a.date.localeCompare(b.date));

    canonical.updatedAt = new Date().toISOString();

    // Retire les dups de la liste
    const dupIdSet = new Set(duplicateIds);
    const next = all.filter((l) => !dupIdSet.has(l.id));
    await this.persist(next);
    this.logger.log(
      `Merged ${duplicateIds.length} duplicate(s) into ${canonicalId} (${canonical.name})`,
    );
    return canonical;
  }

  /**
   * Purge totale des loans — utilisé par /loans/reset. À combiner avec
   * `LoanSuggestionsService.deleteAll()` puis replay auto-sync sur les
   * statements existants.
   */
  async deleteAll(): Promise<{ deletedCount: number }> {
    const all = await this.getAll();
    await this.persist([]);
    this.logger.log(`Deleted all ${all.length} loans`);
    return { deletedCount: all.length };
  }

  private async persist(all: Loan[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loans-changed');
  }
}

export interface DuplicateGroup {
  creditor: string;
  type: 'classic' | 'revolving';
  loans: Array<{
    id: string;
    name: string;
    monthlyPayment: number;
    contractRef?: string;
    rumRefs?: string[];
    maxAmount?: number;
    usedAmount?: number;
    startDate?: string;
    endDate?: string;
    occurrencesCount: number;
    isActive: boolean;
    createdAt: string;
  }>;
  reasons: string[];
}
