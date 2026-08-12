import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson } from '../../common/atomic-write';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { HealthAdvice, HealthDiagnostic } from '../../models/health.model';
import { Loan } from '../../models/loan.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { HealthService } from './health.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';

const FILE = 'health-advice-cache.json';
const RECENT_STATEMENTS_COUNT = 3;
const TOP_CATEGORIES_COUNT = 5;
const OLLAMA_TIMEOUT_MS = 120_000;

interface LoanContext {
  name: string;
  type: string;
  usedAmount: number | null;
  maxAmount: number | null;
  taeg: number | null;
  monthlyPayment: number;
}

interface CategoryContext {
  category: string;
  total: number;
}

/**
 * Conseils budgétaires générés par un LLM local Ollama, à partir d'agrégats
 * UNIQUEMENT (diagnostic de santé financière, crédits actifs résumés, top
 * catégories de dépenses recalculées localement). Aucun libellé de
 * transaction brute n'entre jamais dans le prompt — voir buildTopCategories.
 *
 * Fail-loud : aucun fallback, aucun repli sur Claude. Toute erreur (Ollama
 * down, timeout, réponse malformée) est propagée telle quelle ; c'est au
 * controller de la traduire en HTTP 502 explicite.
 */
@Injectable()
export class HealthAdviceService {
  private readonly logger = new Logger(HealthAdviceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataDir: RequestDataDirService,
    private readonly healthService: HealthService,
    private readonly loansService: LoansService,
    private readonly storageService: StorageService,
  ) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), FILE);
  }

  async getCached(): Promise<HealthAdvice | null> {
    try {
      const raw = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(raw) as HealthAdvice;
    } catch {
      return null;
    }
  }

  async generate(): Promise<HealthAdvice> {
    const [diagnostic, loans, statements] = await Promise.all([
      this.healthService.getDiagnostic(),
      this.loansService.getAll(),
      this.storageService.getAllStatements(),
    ]);

    const prompt = this.buildUserPrompt(diagnostic, loans, statements);
    const advice = await this.requestOllamaAdvice(prompt);
    await atomicWriteJson(this.filepath, advice);
    return advice;
  }

  /** Résumé d'un crédit actif — aucun libellé de transaction, seulement les agrégats du modèle Loan. */
  private buildLoanContext(loans: Loan[]): LoanContext[] {
    return loans
      .filter((l) => l.isActive)
      .map((l) => ({
        name: l.name,
        type: l.type,
        usedAmount: l.usedAmount ?? null,
        maxAmount: l.maxAmount ?? null,
        taeg: l.taeg ?? null,
        monthlyPayment: l.monthlyPayment,
      }));
  }

  /**
   * Top 5 catégories de dépenses sur les 3 derniers relevés, recalculé
   * localement (même logique que `DashboardService.getYearlyOverview`).
   * Ne lit JAMAIS `description`/`normalizedDescription` — seule la
   * `category` (enum fermée) et le montant agrégé sortent de cette fonction.
   */
  private buildTopCategories(statements: MonthlyStatement[]): CategoryContext[] {
    const recent = [...statements]
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .slice(0, RECENT_STATEMENTS_COUNT);

    const catTotals = new Map<string, number>();
    for (const s of recent) {
      for (const t of s.transactions) {
        if (t.amount < 0) {
          catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + Math.abs(t.amount));
        }
      }
    }

    return [...catTotals.entries()]
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_CATEGORIES_COUNT);
  }

  private buildSystemPrompt(): string {
    return (
      "Tu es un conseiller budgétaire francophone qui aide un particulier à améliorer sa santé financière.\n\n" +
      'Le contexte fourni contient UNIQUEMENT des agrégats : un diagnostic de santé financière calculé (verdict, ' +
      'blocs, seuils déclenchés), la liste des crédits actifs résumés (nom, type, encours, plafond, TAEG, mensualité) ' +
      'et le top 5 des catégories de dépenses des 3 derniers mois. Tu ne reçois AUCUNE transaction individuelle.\n\n' +
      'RÈGLES STRICTES :\n' +
      "- N'invente JAMAIS un chiffre qui n'est pas présent dans le contexte fourni. Si une donnée manque, ne la mentionne pas.\n" +
      '- Priorise les conseils par impact : commence par les crédits au TAEG le plus élevé, puis par les postes de ' +
      'dépenses les plus lourds, puis par les blocs du diagnostic les moins bons (rouge avant orange).\n' +
      '- Reste concret et actionnable, 3 à 6 conseils maximum.\n' +
      '- Réponds UNIQUEMENT en JSON valide, avec cette forme exacte : ' +
      '{"advices":[{"priority":1,"title":"...","explanation":"...","estimatedImpact":"..."}]}\n' +
      '- "priority" commence à 1 (le conseil le plus impactant) et incrémente sans trou.'
    );
  }

  private buildUserPrompt(
    diagnostic: HealthDiagnostic,
    loans: Loan[],
    statements: MonthlyStatement[],
  ): string {
    const context = {
      diagnostic,
      creditsActifs: this.buildLoanContext(loans),
      topCategoriesDepenses: this.buildTopCategories(statements),
    };
    return (
      this.buildSystemPrompt() +
      '\n\nVoici la situation financière agrégée :\n\n' +
      JSON.stringify(context, null, 2) +
      '\n\nPropose des conseils budgétaires priorisés selon les règles ci-dessus.'
    );
  }

  private async requestOllamaAdvice(prompt: string): Promise<HealthAdvice> {
    const baseUrl = this.config.get<string>('ollamaAdviceBaseUrl') ?? 'http://localhost:11434';
    const model = this.config.get<string>('ollamaAdviceModel') ?? 'qwen3:32b';

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', prompt }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { response?: string };
    let parsed: { advices?: unknown };
    try {
      parsed = JSON.parse(payload.response ?? '');
    } catch {
      throw new Error('Réponse Ollama invalide');
    }

    const advices = this.validateAdvices(parsed.advices);

    return {
      generatedAt: new Date().toISOString(),
      model,
      advices: [...advices].sort((a, b) => a.priority - b.priority),
    };
  }

  private validateAdvices(raw: unknown): HealthAdvice['advices'] {
    if (!Array.isArray(raw)) {
      throw new Error('Réponse Ollama invalide');
    }
    for (const item of raw) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as Record<string, unknown>).priority !== 'number' ||
        typeof (item as Record<string, unknown>).title !== 'string' ||
        !(item as { title: string }).title.trim() ||
        typeof (item as Record<string, unknown>).explanation !== 'string' ||
        !(item as { explanation: string }).explanation.trim() ||
        typeof (item as Record<string, unknown>).estimatedImpact !== 'string' ||
        !(item as { estimatedImpact: string }).estimatedImpact.trim()
      ) {
        throw new Error('Réponse Ollama invalide');
      }
    }
    return raw as HealthAdvice['advices'];
  }
}
