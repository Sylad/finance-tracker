import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJson } from '../../common/atomic-write';
import { Declaration, DeclarationInput } from '../../models/declaration.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class DeclarationsService {
  private readonly logger = new Logger(DeclarationsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'declarations.json');
  }

  async getAll(): Promise<Declaration[]> {
    try {
      const content = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(content) as Declaration[];
    } catch {
      return [];
    }
  }

  async create(input: DeclarationInput): Promise<Declaration> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const declaration: Declaration = {
      ...this.normalizeInput(input),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    all.push(declaration);
    await this.persist(all);
    this.logger.log(`Created declaration ${declaration.id} (${declaration.label})`);
    return declaration;
  }

  async update(id: string, input: DeclarationInput): Promise<Declaration> {
    const all = await this.getAll();
    const idx = all.findIndex((d) => d.id === id);
    if (idx === -1) throw new NotFoundException(`Declaration ${id} not found`);
    const updated: Declaration = {
      ...all[idx],
      ...this.normalizeInput(input),
      id: all[idx].id,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    all[idx] = updated;
    await this.persist(all);
    this.logger.log(`Updated declaration ${id}`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((d) => d.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Declaration ${id} not found`);
    await this.persist(next);
    this.logger.log(`Deleted declaration ${id}`);
  }

  private normalizeInput(input: DeclarationInput): DeclarationInput {
    return {
      type: input.type,
      label: input.label.trim(),
      amount: Math.abs(input.amount),
      periodicity: input.periodicity,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      category: (input.category ?? '').trim(),
      notes: (input.notes ?? '').trim(),
      matchPattern: (input.matchPattern ?? '').trim(),
    };
  }

  private async persist(all: Declaration[]): Promise<void> {
    await atomicWriteJson(this.filepath, all);
    this.bus.emit('declarations-changed');
  }
}
