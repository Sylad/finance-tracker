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

  private async persist(all: Subscription[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('subscriptions-changed');
  }
}
