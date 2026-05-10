import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJson } from '../../common/atomic-write';
import { ImportLog } from '../../models/import-log.model';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

const MAX_ENTRIES = 200;

@Injectable()
export class ImportLogsService {
  private readonly logger = new Logger(ImportLogsService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), 'import-logs.json');
  }

  async getAll(): Promise<ImportLog[]> {
    try {
      const c = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(c) as ImportLog[];
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${this.filepath}: ${e?.message ?? err}`);
      }
      return [];
    }
  }

  async log(entry: Omit<ImportLog, 'id'>): Promise<ImportLog> {
    const all = await this.getAll();
    const log: ImportLog = { id: randomUUID(), ...entry };
    all.unshift(log);  // newest first
    if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
    await atomicWriteJson(this.filepath, all);
    this.bus.emit('import-logs-changed');
    return log;
  }

  async update(id: string, patch: Partial<Omit<ImportLog, 'id'>>): Promise<ImportLog | null> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch };
    await atomicWriteJson(this.filepath, all);
    this.bus.emit('import-logs-changed');
    return all[idx];
  }
}
