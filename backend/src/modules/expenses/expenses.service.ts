import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SavingsService } from '../savings/savings.service';
import { CandidateClusteringService } from '../credit-detection/candidate-clustering.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';

/**
 * ⚠️ PRIVACY — même exception documentée que credit-detection :
 * les LIBELLÉS de transactions sont envoyés au LLM parce qu'il est STRICTEMENT
 * LOCAL (Ollama sur Big-Blue, aucune donnée ne quitte la machine). Ne jamais
 * brancher ce prompt sur un provider cloud. Cf. CLAUDE.md du projet.
 */

export interface ExpenseTx {
  id: string;
  date: string;
  description: string;
  amount: number;
}

export interface ExpensesBreakdown {
  monthId: string;
  totalDebits: number;
  buckets: {
    credits: { total: number; transactions: ExpenseTx[] };
    subscriptions: { total: number; transactions: ExpenseTx[] };
    savings: { total: number; transactions: ExpenseTx[] };
    neutral: { total: number; transactions: ExpenseTx[] };
  };
  categories: Array<{ category: string; total: number; count: number; transactions: ExpenseTx[] }>;
}

export interface CutSuggestion {
  key: string;
  label: string;
  kind: 'abonnement' | 'achat_ponctuel' | 'autre';
  cuttable: boolean;
  monthlyEstimate: number;
  monthsSeen: number;
  occurrences: number;
  lastSeenDate: string;
  advice: string;
  sampleAmounts: number[];
}

export interface CutSuggestionsResult {
  suggestions: CutSuggestion[];
  analyzedClusters: number;
  skippedClusters: number;
  months: string[];
  errors: string[];
}

const OLLAMA_TIMEOUT_MS = 90_000;
const MAX_CLUSTERS = 40;
const CHUNK_SIZE = 8;

const KIND_VALUES = ['abonnement', 'achat_ponctuel', 'autre'] as const;

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly loans: LoansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly savings: SavingsService,
    private readonly clustering: CandidateClusteringService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- breakdown

  async getBreakdown(monthId?: string): Promise<ExpensesBreakdown> {
    const statements = await this.storage.getAllStatements();
    if (statements.length === 0) throw new NotFoundException('Aucun relevé importé');
    const statement = monthId
      ? statements.find((s) => s.id === monthId)
      : statements[0];
    if (!statement) throw new NotFoundException(`Relevé ${monthId} introuvable`);

    const { loanTxIds, subTxIds, savingsTxIds } = await this.collectAllocatedTxIds();
    const neutralTxIds = ExpensesService.findNeutralOutgoingTxIds(statement.transactions);

    const mk = (t: Transaction): ExpenseTx => ({
      id: t.id, date: t.date, description: t.description, amount: t.amount,
    });
    const buckets: ExpensesBreakdown['buckets'] = {
      credits: { total: 0, transactions: [] },
      subscriptions: { total: 0, transactions: [] },
      savings: { total: 0, transactions: [] },
      neutral: { total: 0, transactions: [] },
    };
    const byCategory = new Map<string, { total: number; transactions: ExpenseTx[] }>();
    let totalDebits = 0;

    for (const t of statement.transactions) {
      if (t.amount >= 0) continue;
      totalDebits += -t.amount;
      const bucket = loanTxIds.has(t.id)
        ? buckets.credits
        : subTxIds.has(t.id)
          ? buckets.subscriptions
          : savingsTxIds.has(t.id)
            ? buckets.savings
            : neutralTxIds.has(t.id)
              ? buckets.neutral
              : null;
      if (bucket) {
        bucket.total += -t.amount;
        bucket.transactions.push(mk(t));
        continue;
      }
      const entry = byCategory.get(t.category) ?? { total: 0, transactions: [] };
      entry.total += -t.amount;
      entry.transactions.push(mk(t));
      byCategory.set(t.category, entry);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    for (const b of Object.values(buckets)) {
      b.total = round(b.total);
      b.transactions.sort((a, b2) => a.amount - b2.amount);
    }
    const categories = [...byCategory.entries()]
      .map(([category, v]) => ({
        category,
        total: round(v.total),
        count: v.transactions.length,
        transactions: v.transactions.sort((a, b2) => a.amount - b2.amount),
      }))
      .sort((a, b2) => b2.total - a.total);

    return { monthId: statement.id, totalDebits: round(totalDebits), buckets, categories };
  }

  // ------------------------------------------------------------ cut proposals

  async proposeCuts(): Promise<CutSuggestionsResult> {
    const statements = (await this.storage.getAllStatements()).slice(0, 3);
    if (statements.length === 0) throw new NotFoundException('Aucun relevé importé');

    const { loanTxIds, subTxIds, savingsTxIds } = await this.collectAllocatedTxIds();
    const excluded = new Set<string>([...loanTxIds, ...subTxIds, ...savingsTxIds]);
    for (const st of statements) {
      for (const id of ExpensesService.findNeutralOutgoingTxIds(st.transactions)) excluded.add(id);
    }

    // minOccurrences=1 : un achat ponctuel important est aussi une coupe possible.
    const clusters = this.clustering.buildClusters(statements, excluded, 1);
    const monthsCount = statements.length;
    const enriched = clusters
      .map((c) => {
        const total = c.occurrences.reduce((s, o) => s + Math.abs(o.amount), 0);
        const months = new Set(c.occurrences.map((o) => o.date.slice(0, 7)));
        return {
          key: c.key,
          label: c.occurrences[c.occurrences.length - 1].description,
          occurrences: c.occurrences,
          monthsSeen: months.size,
          monthlyEstimate: Math.round((total / monthsCount) * 100) / 100,
          lastSeenDate: c.occurrences[c.occurrences.length - 1].date,
        };
      })
      // Sous 5€/mois estimé : pas la peine d'occuper le LLM ni l'écran.
      .filter((c) => c.monthlyEstimate >= 5)
      .sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);

    const kept = enriched.slice(0, MAX_CLUSTERS);
    const skippedClusters = enriched.length - kept.length;
    if (skippedClusters > 0) {
      this.logger.log(`proposeCuts: ${skippedClusters} clusters sous le cap de ${MAX_CLUSTERS} non analysés`);
    }

    const errors: string[] = [];
    const suggestions: CutSuggestion[] = [];
    let anySuccess = false;
    for (let i = 0; i < kept.length; i += CHUNK_SIZE) {
      const chunk = kept.slice(i, i + CHUNK_SIZE);
      try {
        const classified = await this.classifyChunk(chunk);
        anySuccess = true;
        for (const c of chunk) {
          const verdict = classified.get(c.key);
          suggestions.push({
            key: c.key,
            label: c.label,
            kind: verdict?.kind ?? 'autre',
            cuttable: verdict?.cuttable ?? false,
            monthlyEstimate: c.monthlyEstimate,
            monthsSeen: c.monthsSeen,
            occurrences: c.occurrences.length,
            lastSeenDate: c.lastSeenDate,
            advice: verdict?.advice ?? 'Classification indisponible — à trier manuellement.',
            sampleAmounts: c.occurrences.slice(-3).map((o) => Math.round(Math.abs(o.amount) * 100) / 100),
          });
        }
      } catch (e) {
        errors.push(`clusters ${i + 1}-${i + chunk.length}: ${(e as Error).message}`);
        this.logger.warn(`proposeCuts chunk failed: ${(e as Error).message}`);
      }
    }

    if (!anySuccess && kept.length > 0) {
      throw new BadGatewayException(`Ollama indisponible : ${errors[0] ?? 'aucune réponse'}`);
    }

    suggestions.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
    return {
      suggestions,
      analyzedClusters: kept.length,
      skippedClusters,
      months: statements.map((s) => s.id),
      errors,
    };
  }

  private async classifyChunk(
    clusters: Array<{ key: string; occurrences: Array<{ date: string; amount: number; description: string }>; monthsSeen: number; monthlyEstimate: number }>,
  ): Promise<Map<string, { kind: CutSuggestion['kind']; cuttable: boolean; advice: string }>> {
    const baseUrl = this.config.get<string>('ollamaAdviceBaseUrl') ?? 'http://localhost:11434';
    const model = this.config.get<string>('ollamaDetectionModel') ?? 'qwen3:32b';

    const lines = clusters.map((c) => {
      const occ = c.occurrences
        .slice(-6)
        .map((o) => `${o.date} ${o.amount.toFixed(2)}€ "${o.description.slice(0, 50)}"`)
        .join(' ; ');
      return `- key="${c.key}" | vu sur ${c.monthsSeen} mois | ~${c.monthlyEstimate}€/mois | ${occ}`;
    });

    const prompt =
      "Tu es un conseiller budgétaire français. On te donne des séries de DÉBITS bancaires regroupés par contrepartie " +
      "(les crédits, abonnements déjà connus et virements d'épargne sont déjà exclus). Pour CHAQUE série, classe :\n" +
      "- kind: 'abonnement' (dépense récurrente ~mensuelle à montant stable : streaming, logiciel, salle de sport, presse, télésurveillance, assurance…), " +
      "'achat_ponctuel' (achat commerce/loisir non récurrent), 'autre' (frais bancaires, factures variables, inclassable)\n" +
      "- cuttable: true si cette dépense est raisonnablement supprimable ou réductible pour quelqu'un qui doit économiser " +
      "(loisirs, gadgets, abonnements de confort) ; false pour l'essentiel (alimentation de base, énergie, santé, impôts)\n" +
      "- advice: UNE phrase courte et concrète en français (ex: « Résilier si non utilisé — 12€/mois économisés »)\n\n" +
      "Une série vue sur 1 seul mois n'est JAMAIS kind='abonnement'. N'invente aucun chiffre.\n\n" +
      "Séries :\n" + lines.join('\n') + "\n\n" +
      'Réponds UNIQUEMENT en JSON : {"items":[{"key":"...","kind":"...","cuttable":true|false,"advice":"..."}]} — ' +
      'une entrée par série, key recopiée exactement.';

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', prompt }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = (await response.json()) as { response?: string };
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.response ?? '');
    } catch {
      throw new Error('Réponse Ollama invalide: JSON illisible');
    }

    const out = new Map<string, { kind: CutSuggestion['kind']; cuttable: boolean; advice: string }>();
    const items = (parsed as { items?: unknown[] })?.items;
    if (!Array.isArray(items)) throw new Error('Réponse Ollama invalide: items manquant');
    const monthsByKey = new Map(clusters.map((c) => [c.key, c.monthsSeen]));
    for (const raw of items) {
      const r = raw as Record<string, unknown>;
      const key = typeof r.key === 'string' ? r.key : null;
      if (!key || !monthsByKey.has(key)) continue;
      let kind = (KIND_VALUES as readonly string[]).includes(r.kind as string)
        ? (r.kind as CutSuggestion['kind'])
        : 'autre';
      // Garde déterministe : abonnement exige ≥2 mois distincts, quoi qu'en dise le LLM.
      if (kind === 'abonnement' && (monthsByKey.get(key) ?? 0) < 2) kind = 'achat_ponctuel';
      out.set(key, {
        kind,
        cuttable: r.cuttable === true,
        advice: typeof r.advice === 'string' && r.advice.trim() ? r.advice.trim() : 'À examiner.',
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ helpers

  private async collectAllocatedTxIds(): Promise<{
    loanTxIds: Set<string>; subTxIds: Set<string>; savingsTxIds: Set<string>;
  }> {
    const [loans, subs, savings] = await Promise.all([
      this.loans.getAll(),
      this.subscriptions.getAll(),
      this.savings.getAll(),
    ]);
    const loanTxIds = new Set<string>();
    for (const l of loans) for (const o of l.occurrencesDetected) if (o.transactionId) loanTxIds.add(o.transactionId);
    const subTxIds = new Set<string>();
    for (const s of subs) for (const o of s.occurrencesDetected) if (o.transactionId) subTxIds.add(o.transactionId);
    const savingsTxIds = new Set<string>();
    for (const a of savings) for (const m of a.movements) if (m.transactionId) savingsTxIds.add(m.transactionId);
    return { loanTxIds, subTxIds, savingsTxIds };
  }

  /**
   * Paires neutres locales au relevé : un débit compensé par un crédit de
   * même montant (±0.01€) à ≤7 jours (remboursement redirigé, annulation).
   * Version simplifiée de health.service — greedy par proximité de date.
   */
  static findNeutralOutgoingTxIds(transactions: Transaction[]): Set<string> {
    const debits = transactions.filter((t) => t.amount < 0);
    const credits = transactions.filter((t) => t.amount > 0);
    const usedCredits = new Set<string>();
    const neutral = new Set<string>();
    for (const d of debits) {
      let best: { id: string; gap: number } | null = null;
      for (const c of credits) {
        if (usedCredits.has(c.id)) continue;
        if (Math.abs(c.amount + d.amount) > 0.01) continue;
        const gap = Math.abs(new Date(c.date).getTime() - new Date(d.date).getTime());
        if (gap > 7 * 24 * 3600 * 1000) continue;
        if (!best || gap < best.gap) best = { id: c.id, gap };
      }
      if (best) {
        usedCredits.add(best.id);
        neutral.add(d.id);
      }
    }
    return neutral;
  }
}
