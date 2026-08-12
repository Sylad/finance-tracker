import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson } from '../../common/atomic-write';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { DEFAULT_THRESHOLDS, HealthThresholds } from '../../models/health.model';

const FILE = 'health-thresholds.json';

@Injectable()
export class HealthThresholdsService {
  constructor(private readonly dataDir: RequestDataDirService) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), FILE);
  }

  async get(): Promise<HealthThresholds> {
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as Partial<HealthThresholds>;
      return this.mergeDefaults(raw);
    } catch {
      return structuredClone(DEFAULT_THRESHOLDS);
    }
  }

  async update(patch: Partial<HealthThresholds>): Promise<HealthThresholds> {
    const merged = this.mergeDefaults({ ...(await this.get()), ...patch });
    await atomicWriteJson(this.filepath, merged);
    return merged;
  }

  async reset(): Promise<HealthThresholds> {
    const defaults = structuredClone(DEFAULT_THRESHOLDS);
    await atomicWriteJson(this.filepath, defaults);
    return defaults;
  }

  private mergeDefaults(raw: Partial<HealthThresholds>): HealthThresholds {
    return {
      resteAVivre: { ...DEFAULT_THRESHOLDS.resteAVivre, ...raw.resteAVivre },
      tauxEffort: { ...DEFAULT_THRESHOLDS.tauxEffort, ...raw.tauxEffort },
      plafonds: { ...DEFAULT_THRESHOLDS.plafonds, ...raw.plafonds },
      tirages: { ...DEFAULT_THRESHOLDS.tirages, ...raw.tirages },
      trajectoire: { ...DEFAULT_THRESHOLDS.trajectoire, ...raw.trajectoire },
      manualMonthlyIncome: raw.manualMonthlyIncome ?? null,
    };
  }
}
