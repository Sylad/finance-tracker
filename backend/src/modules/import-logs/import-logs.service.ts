import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
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
    } catch { return []; }
  }

  async log(entry: Omit<ImportLog, 'id'>): Promise<ImportLog> {
    const all = await this.getAll();
    const log: ImportLog = { id: randomUUID(), ...entry };
    all.unshift(log);  // newest first
    if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('import-logs-changed');
    return log;
  }

  async update(id: string, patch: Partial<Omit<ImportLog, 'id'>>): Promise<ImportLog | null> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch };
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('import-logs-changed');
    return all[idx];
  }
}
