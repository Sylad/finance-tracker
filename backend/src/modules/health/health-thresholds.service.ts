import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson } from '../../common/atomic-write';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import {
  DEFAULT_THRESHOLDS,
  HealthThresholds,
} from '../../models/health.model';

const FILE = 'health-thresholds.json';

@Injectable()
export class HealthThresholdsService {
  constructor(private readonly dataDir: RequestDataDirService) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), FILE);
  }

  async get(): Promise<HealthThresholds> {
    try {
      const raw = JSON.parse(
        await fs.promises.readFile(this.filepath, 'utf8'),
      ) as Partial<HealthThresholds>;
      return this.mergeDefaults(raw);
    } catch {
      return structuredClone(DEFAULT_THRESHOLDS);
    }
  }

  async update(patch: Partial<HealthThresholds>): Promise<HealthThresholds> {
    const current = await this.get();
    const merged = this.deepMerge(current, patch);
    await atomicWriteJson(this.filepath, merged);
    return merged;
  }

  async reset(): Promise<HealthThresholds> {
    const defaults = structuredClone(DEFAULT_THRESHOLDS);
    await atomicWriteJson(this.filepath, defaults);
    return defaults;
  }

  private deepMerge(
    current: HealthThresholds,
    patch: Partial<HealthThresholds>,
  ): HealthThresholds {
    return {
      resteAVivre: patch.resteAVivre
        ? { ...current.resteAVivre, ...patch.resteAVivre }
        : current.resteAVivre,
      tauxEffort: patch.tauxEffort
        ? { ...current.tauxEffort, ...patch.tauxEffort }
        : current.tauxEffort,
      plafonds: patch.plafonds
        ? {
            greenBelowPct:
              patch.plafonds.greenBelowPct ?? current.plafonds.greenBelowPct,
            redAbovePct:
              patch.plafonds.redAbovePct ?? current.plafonds.redAbovePct,
          }
        : current.plafonds,
      tirages: patch.tirages
        ? { ...current.tirages, ...patch.tirages }
        : current.tirages,
      trajectoire: patch.trajectoire
        ? { ...current.trajectoire, ...patch.trajectoire }
        : current.trajectoire,
      manualMonthlyIncome:
        patch.manualMonthlyIncome !== undefined
          ? HealthThresholdsService.clampManualMonthlyIncome(
              patch.manualMonthlyIncome,
            )
          : current.manualMonthlyIncome,
    };
  }

  /**
   * Un revenu manuel n'a de sens que positif et fini — 0, négatif, NaN,
   * Infinity ou une valeur non numérique (payload mal formé) sont traités
   * comme "pas de revenu manuel" plutôt que persistés tels quels (F3).
   */
  private static clampManualMonthlyIncome(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  private mergeDefaults(raw: Partial<HealthThresholds>): HealthThresholds {
    return {
      resteAVivre: { ...DEFAULT_THRESHOLDS.resteAVivre, ...raw.resteAVivre },
      tauxEffort: { ...DEFAULT_THRESHOLDS.tauxEffort, ...raw.tauxEffort },
      // Reconstruction explicite (pas de spread de raw.plafonds) : un
      // fichier persisté par une version antérieure peut encore contenir
      // l'ancienne clé `orangeAbovePct` (F2, champ supprimé du modèle) —
      // elle doit être silencieusement ignorée au chargement plutôt que de
      // fuiter dans l'objet mergé.
      plafonds: {
        greenBelowPct:
          raw.plafonds?.greenBelowPct ??
          DEFAULT_THRESHOLDS.plafonds.greenBelowPct,
        redAbovePct:
          raw.plafonds?.redAbovePct ?? DEFAULT_THRESHOLDS.plafonds.redAbovePct,
      },
      tirages: { ...DEFAULT_THRESHOLDS.tirages, ...raw.tirages },
      trajectoire: { ...DEFAULT_THRESHOLDS.trajectoire, ...raw.trajectoire },
      manualMonthlyIncome: raw.manualMonthlyIncome ?? null,
    };
  }
}
