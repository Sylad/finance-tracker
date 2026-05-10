import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  Subscription,
  SubscriptionInput,
  SubscriptionOccurrence,
  SubscriptionOccurrenceSource,
} from '../../models/subscription.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'subscriptions.json');
  }

  async getAll(): Promise<Subscription[]> {
    try {
      const c = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(c) as Subscription[];
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${this.filepath}: ${e?.message ?? err}`);
      }
      return [];
    }
  }

  async getOne(id: string): Promise<Subscription> {
    const s = (await this.getAll()).find((x) => x.id === id);
    if (!s) throw new NotFoundException(`Abonnement ${id} introuvable`);
    return s;
  }

  async create(input: SubscriptionInput): Promise<Subscription> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const sub: Subscription = {
      ...input,
      id: randomUUID(),
      occurrencesDetected: [],
      createdAt: now,
      updatedAt: now,
    };
    all.push(sub);
    await this.persist(all);
    this.logger.log(`Created subscription ${sub.id} (${sub.name})`);
    return sub;
  }

  async update(id: string, input: SubscriptionInput): Promise<Subscription> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Abonnement ${id} introuvable`);
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
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Abonnement ${id} introuvable`);
    await this.persist(next);
  }

  /**
   * Ajoute une occurrence avec dédup stricte (statementId, transactionId).
   * Pas de dédup mensuelle agressive comme les loans : un abonnement peut
   * légitimement avoir plusieurs prélèvements le même mois (rare mais
   * possible — ex. ajustement de tarif rétroactif).
   */
  async addOccurrence(
    id: string,
    occ: {
      statementId: string;
      date: string;
      amount: number;
      transactionId: string | null;
      description?: string;
      source?: SubscriptionOccurrenceSource;
    },
  ): Promise<Subscription> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Abonnement ${id} introuvable`);
    const sub = all[idx];

    const dupKey = (o: SubscriptionOccurrence) => `${o.statementId}|${o.transactionId ?? ''}`;
    const newKey = `${occ.statementId}|${occ.transactionId ?? ''}`;
    if (sub.occurrencesDetected.some((o) => dupKey(o) === newKey)) {
      this.logger.debug(`Skipping duplicate subscription occurrence on ${id} (${newKey})`);
      return sub;
    }

    const newOcc: SubscriptionOccurrence = {
      id: randomUUID(),
      ...occ,
      source: occ.source ?? 'bank_statement',
    };
    sub.occurrencesDetected.push(newOcc);
    sub.updatedAt = new Date().toISOString();
    await this.persist(all);
    return sub;
  }

  async removeOccurrencesForStatement(statementId: string): Promise<void> {
    const all = await this.getAll();
    let dirty = false;
    for (const sub of all) {
      const before = sub.occurrencesDetected.length;
      sub.occurrencesDetected = sub.occurrencesDetected.filter(
        (o) => o.statementId !== statementId,
      );
      if (sub.occurrencesDetected.length !== before) {
        dirty = true;
        sub.updatedAt = new Date().toISOString();
      }
    }
    if (dirty) await this.persist(all);
  }

  /**
   * Cherche un Subscription existant qui ressemble fortement à `signals`.
   * Heuristique :
   *   - matchPattern identique (normalisé) → high confidence
   *   - normalizedName identique (slug du `name` sans accents) → medium
   *   - monthlyAmount identique ±5% + nom contenant un même mot-clé → low
   * Utilisé à l'accept de suggestion pour éviter de re-créer un doublon.
   */
  async findExisting(signals: {
    name?: string;
    matchPattern?: string;
    monthlyAmount?: number;
  }): Promise<Subscription | null> {
    const all = await this.getAll();
    if (all.length === 0) return null;
    const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const normPattern = (p: string) => p.toLowerCase().replace(/[\\^$.*+?()[\]{}|]/g, '').replace(/\s+/g, ' ').trim();

    if (signals.matchPattern) {
      const target = normPattern(signals.matchPattern);
      const m = all.find((s) => normPattern(s.matchPattern) === target);
      if (m) return m;
    }
    if (signals.name) {
      const targetSlug = slugify(signals.name);
      const m = all.find((s) => slugify(s.name) === targetSlug);
      if (m) return m;
      // Mot-clé partagé + montant proche → low confidence match
      if (signals.monthlyAmount != null && signals.monthlyAmount > 0) {
        const targetWords = new Set(targetSlug.split(' ').filter((w) => w.length >= 3));
        const m2 = all.find((s) => {
          const slug = slugify(s.name);
          const words = new Set(slug.split(' ').filter((w) => w.length >= 3));
          const shared = [...targetWords].filter((w) => words.has(w));
          if (shared.length === 0) return false;
          const tolerance = Math.max(s.monthlyAmount, signals.monthlyAmount!) * 0.05;
          return Math.abs(s.monthlyAmount - signals.monthlyAmount!) <= tolerance;
        });
        if (m2) return m2;
      }
    }
    return null;
  }

  /**
   * Détection de doublons. Heuristique :
   *   - même montant ±5% (rounded euro key)
   *   - ET partage d'un mot-clé ≥3 lettres entre les noms (slugifiés)
   *   - OU même slug normalisé
   *   - OU partage d'au moins un mois d'occurrence (invariant 1 prélèvement/mois)
   *
   * Retourne des groupes de candidats (≥2 subs) avec une raison.
   */
  async detectDuplicates(): Promise<Array<{
    normalizedName: string;
    monthlyAmount: number;
    subscriptions: Array<{
      id: string;
      name: string;
      monthlyAmount: number;
      matchPattern: string;
      occurrencesCount: number;
      isActive: boolean;
      createdAt: string;
    }>;
    reasons: string[];
  }>> {
    const all = await this.getAll();
    if (all.length < 2) return [];
    const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const slugWords = (s: string) => new Set(slugify(s).split(' ').filter((w) => w.length >= 3));

    type Bucket = { subs: Subscription[]; reasons: Set<string> };
    const groups = new Map<string, Bucket>();

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const tol = Math.max(a.monthlyAmount, b.monthlyAmount) * 0.05;
        const closeAmount = Math.abs(a.monthlyAmount - b.monthlyAmount) <= tol;
        const sameSlug = slugify(a.name) === slugify(b.name);
        const wordsA = slugWords(a.name);
        const wordsB = slugWords(b.name);
        const sharedWords = [...wordsA].filter((w) => wordsB.has(w));
        const monthsA = new Set((a.occurrencesDetected ?? []).map((o) => o.date.slice(0, 7)));
        const monthsB = new Set((b.occurrencesDetected ?? []).map((o) => o.date.slice(0, 7)));
        const sharesMonth = [...monthsA].some((m) => monthsB.has(m));

        const reasons: string[] = [];
        if (sameSlug) reasons.push(`Nom normalisé identique : ${slugify(a.name)}`);
        if (closeAmount && sharedWords.length > 0) {
          reasons.push(`Montant ±5% (${a.monthlyAmount.toFixed(2)}€ ↔ ${b.monthlyAmount.toFixed(2)}€) + mot(s) communs : ${sharedWords.join(', ')}`);
        }
        if (sharesMonth) {
          const list = [...monthsA].filter((m) => monthsB.has(m)).sort().join(', ');
          reasons.push(`Invariant violé "1 prélèvement/mois max" : occurrences même(s) mois (${list})`);
        }
        if (reasons.length === 0) continue;

        // Clé du groupe : on regroupe les paires connectées via union-find
        // simplifié — on utilise (slug-or-shared-word, amount-rounded).
        const sharedKey = sameSlug
          ? slugify(a.name)
          : sharedWords[0] ?? slugify(a.name).split(' ')[0];
        const key = `${sharedKey}|${Math.round(a.monthlyAmount)}`;
        const bucket = groups.get(key) ?? { subs: [], reasons: new Set() };
        if (!bucket.subs.some((s) => s.id === a.id)) bucket.subs.push(a);
        if (!bucket.subs.some((s) => s.id === b.id)) bucket.subs.push(b);
        for (const r of reasons) bucket.reasons.add(r);
        groups.set(key, bucket);
      }
    }

    const results = [];
    for (const [key, bucket] of groups) {
      if (bucket.subs.length < 2) continue;
      const [namePart, amountPart] = key.split('|');
      results.push({
        normalizedName: namePart,
        monthlyAmount: Number(amountPart),
        subscriptions: bucket.subs.map((s) => ({
          id: s.id,
          name: s.name,
          monthlyAmount: s.monthlyAmount,
          matchPattern: s.matchPattern,
          occurrencesCount: s.occurrencesDetected.length,
          isActive: s.isActive,
          createdAt: s.createdAt,
        })),
        reasons: [...bucket.reasons],
      });
    }
    return results;
  }

  /**
   * Fusionne plusieurs subscriptions dans un canonical : migre les
   * occurrences (dédup par (statementId, transactionId)), puis supprime
   * les duplicates.
   */
  async mergeDuplicates(canonicalId: string, duplicateIds: string[]): Promise<Subscription> {
    if (duplicateIds.includes(canonicalId)) {
      throw new NotFoundException('canonicalId ne peut pas être dans duplicateIds');
    }
    const all = await this.getAll();
    const canonical = all.find((s) => s.id === canonicalId);
    if (!canonical) throw new NotFoundException(`Abonnement canonical ${canonicalId} introuvable`);
    const dups = duplicateIds.map((id) => {
      const f = all.find((s) => s.id === id);
      if (!f) throw new NotFoundException(`Abonnement ${id} introuvable`);
      return f;
    });
    const dupKey = (o: SubscriptionOccurrence) => `${o.statementId}|${o.transactionId ?? ''}`;
    const seen = new Set(canonical.occurrencesDetected.map(dupKey));
    for (const dup of dups) {
      for (const occ of dup.occurrencesDetected) {
        const k = dupKey(occ);
        if (seen.has(k)) continue;
        canonical.occurrencesDetected.push(occ);
        seen.add(k);
      }
    }
    canonical.updatedAt = new Date().toISOString();
    const dupIdSet = new Set(duplicateIds);
    const next = all.filter((s) => !dupIdSet.has(s.id));
    await this.persist(next);
    this.logger.log(`Merged ${duplicateIds.length} subscriptions into ${canonical.id}`);
    return canonical;
  }

  /**
   * Purge totale — utilisée par /reset-subscriptions pour repartir d'une
   * base saine après un cycle de doublons.
   */
  async deleteAll(): Promise<{ deletedCount: number }> {
    const all = await this.getAll();
    await this.persist([]);
    this.logger.log(`Deleted all ${all.length} subscriptions`);
    return { deletedCount: all.length };
  }

  private async persist(all: Subscription[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('subscriptions-changed');
  }
}
