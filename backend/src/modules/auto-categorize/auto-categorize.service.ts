import { Injectable, Logger, HttpException, HttpStatus, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { StorageService } from '../storage/storage.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { isAuthError, isQuotaError } from '../../common/claude-errors';
import { parseExternal } from '../../common/zod-validation.pipe';
import { AutoCategorizeOutputSchema } from './auto-categorize.schemas';
import { Transaction, TransactionCategory } from '../../models/transaction.model';
import { CategoryRule } from '../../models/category-rule.model';
import { CLAUDE_MODEL } from '../analysis/claude-model';
import { AUTO_TOOL_CHOICE, onlyToolInstruction, requireToolUse, runWithToolRetry } from '../analysis/forced-tool.helper';
import { lookupMerchant, merchantPattern, rawLabel } from '../category-rules/merchant-dictionary';

export interface CategorizationSuggestion {
  transactionId: string;
  description: string;
  amount: number;
  date: string;
  currentCategory: string;
  suggestedCategory: string;
  confidence: number;
  reasoning: string;
  proposedRulePattern: string | null;
  /** Origine de la suggestion (L75) : dictionnaire de marchands local ou Claude. */
  source?: 'dictionary' | 'claude';
}

export interface AutoCategorizePreview {
  statementId: string;
  totalOther: number;
  processed: number;
  suggestions: CategorizationSuggestion[];
  availableCategories: string[];
  warnings: string[];
}

interface ApplyDecision {
  transactionId: string;
  category: string;
  rulePattern?: string;       // present → also create a category rule
  replayAll?: boolean;        // only meaningful if rulePattern present
}

export interface ApplyResult {
  statementId: string;
  applied: number;
  rulesCreated: number;
  replayed: number;
}

const BATCH_SIZE = 10;
const MIN_CONFIDENCE_DEFAULT = 0.55;

@Injectable()
export class AutoCategorizeService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AutoCategorizeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly categoryRules: CategoryRulesService,
    private readonly dataDir: RequestDataDirService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropicApiKey'),
    });
  }

  /**
   * Preview only — calls Claude on every `other` transaction of the given
   * statement, but does NOT mutate any data.
   *
   * Demo mode is rejected: this endpoint costs Anthropic tokens, no reason
   * to let public Cloudflare visitors burn the shared balance.
   */
  async preview(statementId: string): Promise<AutoCategorizePreview> {
    this.assertNotDemo();
    const statement = await this.storage.getStatement(statementId);
    if (!statement) throw new NotFoundException(`Relevé ${statementId} introuvable`);

    const others = statement.transactions.filter((t) => t.category === 'other');
    const availableCategories = await this.categoryRules.getAvailableCategories();
    if (others.length === 0) {
      return {
        statementId,
        totalOther: 0,
        processed: 0,
        suggestions: [],
        availableCategories,
        warnings: [],
      };
    }

    const warnings: string[] = [];
    const allSuggestions: CategorizationSuggestion[] = [];

    // Dictionnaire de marchands d'abord (L75, R10) : les débits reconnus sont
    // des suggestions sûres et ne partent pas à Claude.
    const toClaude: Transaction[] = [];
    for (const tx of others) {
      const hit = tx.amount < 0 ? lookupMerchant(rawLabel(tx)) : null;
      if (!hit) {
        toClaude.push(tx);
        continue;
      }
      allSuggestions.push({
        transactionId: tx.id,
        description: tx.description,
        amount: tx.amount,
        date: tx.date,
        currentCategory: tx.category,
        suggestedCategory: hit.category,
        confidence: 1,
        reasoning: `Marchand reconnu : ${hit.label}`,
        proposedRulePattern: dictionaryRulePattern(tx),
        source: 'dictionary',
      });
    }

    // Run batches in parallel — Claude SDK handles concurrency, and at
    // BATCH_SIZE=10 a typical month has 1-3 batches.
    const batches = chunk(toClaude, BATCH_SIZE);
    const results = await Promise.allSettled(
      batches.map((batch) => this.askClaudeForBatch(batch, availableCategories)),
    );

    const byId = new Map(toClaude.map((t) => [t.id, t]));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        // Re-throw quota / auth errors so the caller sees a proper status.
        const err = r.reason as unknown;
        if (err instanceof HttpException) throw err;
        warnings.push(`Batch ${i + 1}/${batches.length} : ${(err as Error)?.message ?? 'erreur inconnue'}`);
        continue;
      }
      for (const s of r.value) {
        const tx = byId.get(s.transactionId);
        if (!tx) continue;
        // Filter out invalid / hallucinated categories
        if (!availableCategories.includes(s.suggestedCategory)) {
          warnings.push(`Catégorie inconnue ignorée : "${s.suggestedCategory}" pour ${tx.description}`);
          continue;
        }
        if (s.suggestedCategory === 'other') continue; // no value
        // Validate proposed rule pattern (must be valid regex AND match the tx)
        let rulePattern: string | null = null;
        if (s.proposedRulePattern && typeof s.proposedRulePattern === 'string') {
          rulePattern = sanitizeRulePattern(s.proposedRulePattern, tx);
          if (!rulePattern) {
            warnings.push(`Regex invalide rejetée : ${s.proposedRulePattern}`);
          }
        }
        allSuggestions.push({
          transactionId: tx.id,
          description: tx.description,
          amount: tx.amount,
          date: tx.date,
          currentCategory: tx.category,
          suggestedCategory: s.suggestedCategory,
          confidence: s.confidence,
          reasoning: s.reasoning,
          proposedRulePattern: rulePattern,
          source: 'claude',
        });
      }
    }

    // Sort by confidence desc so the UI surfaces the high-quality picks first.
    allSuggestions.sort((a, b) => b.confidence - a.confidence);

    return {
      statementId,
      totalOther: others.length,
      processed: others.length,
      suggestions: allSuggestions,
      availableCategories,
      warnings,
    };
  }

  /**
   * Apply a list of user-vetted decisions to the given statement. Optionally
   * creates category rules and replays them on the full history.
   */
  async apply(statementId: string, decisions: ApplyDecision[]): Promise<ApplyResult> {
    this.assertNotDemo();
    const statement = await this.storage.getStatement(statementId);
    if (!statement) throw new NotFoundException(`Relevé ${statementId} introuvable`);
    if (!Array.isArray(decisions) || decisions.length === 0) {
      throw new BadRequestException('Aucune décision à appliquer');
    }

    const txById = new Map(statement.transactions.map((t) => [t.id, t]));

    let applied = 0;
    const createdRules: CategoryRule[] = [];
    const wantReplayAll = decisions.some((d) => d.rulePattern && d.replayAll);

    for (const d of decisions) {
      const tx = txById.get(d.transactionId);
      if (!tx) continue;
      tx.category = d.category as TransactionCategory;
      applied++;

      if (d.rulePattern && d.rulePattern.trim()) {
        try {
          // Validate the pattern compiles AND that it actually matches the tx —
          // otherwise we'd ship rules that never fire, which is worse than no rule.
          const re = new RegExp(d.rulePattern, 'i');
          const haystack = tx.normalizedDescription || tx.description || '';
          if (!re.test(haystack)) {
            this.logger.warn(`Pattern "${d.rulePattern}" doesn't match "${haystack}" — skipping rule`);
          } else {
            const rule = await this.categoryRules.create({
              pattern: d.rulePattern,
              flags: 'i',
              category: d.category,
              priority: 100,
            });
            createdRules.push(rule);
          }
        } catch (err) {
          this.logger.warn(`Invalid regex "${d.rulePattern}" — skipping: ${(err as Error).message}`);
        }
      }
    }

    await this.storage.saveStatement(statement);

    const replayed =
      wantReplayAll && createdRules.length > 0
        ? (await this.categoryRules.replayAll({ skipStatementId: statement.id })).updated
        : 0;

    return {
      statementId,
      applied,
      rulesCreated: createdRules.length,
      replayed,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private assertNotDemo(): void {
    if (this.dataDir.isDemoMode()) {
      throw new ForbiddenException(
        "L'auto-catégorisation Claude n'est pas disponible en mode démo (consomme des tokens API).",
      );
    }
  }

  private async askClaudeForBatch(
    batch: Transaction[],
    availableCategories: string[],
  ): Promise<Array<{ transactionId: string; suggestedCategory: string; confidence: number; reasoning: string; proposedRulePattern: string | null }>> {
    const tool = buildCategorizeTool(availableCategories);

    const txList = batch
      .map((t, i) => `${i + 1}. id=${t.id} | ${t.date} | ${t.amount > 0 ? '+' : ''}${t.amount}€ | ${t.description}`)
      .join('\n');

    try {
      const message = await runWithToolRetry(() => this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system:
          "Tu es un expert de la catégorisation de transactions bancaires françaises. " +
          "Pour chaque transaction fournie (toutes actuellement classées en 'other'), suggère la catégorie la plus pertinente parmi la liste disponible. " +
          "Tu DOIS appeler l'outil `categorize_transactions` une seule fois avec un tableau `suggestions`.\n\n" +
          "RÈGLES :\n" +
          "- Conserve l'`id` exact fourni dans `transactionId`.\n" +
          "- `suggestedCategory` doit être l'une des valeurs autorisées.\n" +
          "- `confidence` ∈ [0, 1] : 1 = certain, 0.6 = plausible, ≤ 0.4 = doute (la suggestion sera filtrée côté UI).\n" +
          "- Si la transaction reste vraiment indéterminée, propose tout de même la meilleure catégorie avec une confidence basse — ne renvoie pas 'other'.\n" +
          "- `reasoning` : 1 phrase courte en français (ex: 'Achat alimentaire en supermarché', 'Mensualité crédit conso CETELEM').\n" +
          "- `proposedRulePattern` (recommandé pour les marchands clairs) : regex insensible à la casse simple ciblant un fragment stable du libellé (ex: 'CARREFOUR', 'PRELEVT.*CETELEM'). Évite les détails volatiles (numéros de carte, dates, montants). Mets null si tu n'es pas sûr que la regex matche le libellé.\n\n" +
          "CATÉGORIES STANDARD :\n" +
          "- income (entrée d'argent : salaire, virements reçus tiers, remboursements)\n" +
          "- housing (loyer, charges copro, EDF, eau, gaz, assurance habitation)\n" +
          "- transport (Navigo, RATP, SNCF, essence, péage, parking, auto-école)\n" +
          "- food (supermarché, boucherie, boulangerie, livraison repas)\n" +
          "- health (pharmacie, médecin, mutuelle, optique, hôpital)\n" +
          "- entertainment (cinéma, restaurants, sorties, jeux)\n" +
          "- subscriptions (Netflix, Spotify, télécom, streaming, presse, télésurveillance)\n" +
          "- savings (virement vers Livret A / PEL / LDDS, achats actions)\n" +
          "- transfers (virements internes entre comptes du même titulaire)\n" +
          "- taxes (impôts, taxe foncière, prélèvement DGFIP)\n" +
          "- other (uniquement en dernier recours, à éviter)\n" +
          "Toute catégorie utilisateur supplémentaire fournie est aussi valide.\n\n" +
          onlyToolInstruction('categorize_transactions'),
        tools: [tool],
        tool_choice: AUTO_TOOL_CHOICE,
        messages: [
          {
            role: 'user',
            content:
              `Catégories autorisées : ${availableCategories.join(', ')}\n\n` +
              `Transactions à catégoriser (toutes actuellement 'other') :\n${txList}\n\n` +
              `Renvoie une suggestion par transaction.`,
          },
        ],
      }), 'categorize_transactions', () => {
        this.logger.warn('auto-categorize: aucun tool_use categorize_transactions, un nouvel essai');
      });

      const block = requireToolUse(message, 'categorize_transactions');

      const parsed = parseExternal(AutoCategorizeOutputSchema, block.input, 'Claude auto-categorize');

      return parsed.suggestions.map((s) => ({
        transactionId: s.transactionId,
        suggestedCategory: s.suggestedCategory,
        confidence: s.confidence,
        reasoning: s.reasoning,
        proposedRulePattern: s.proposedRulePattern ?? null,
      }));
    } catch (err) {
      if (isAuthError(err)) {
        throw new HttpException(
          {
            code: 'CLAUDE_AUTH_ERROR',
            message: 'Clé API Claude invalide/révoquée — vérifie ANTHROPIC_API_KEY',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (isQuotaError(err)) {
        throw new HttpException('CLAUDE_QUOTA_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
      }
      throw err;
    }
  }
}

// ── helpers (exported for tests) ─────────────────────────────────────────────

export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Motif de marchand (R15, mots de l'enseigne) ; null s'il est trop court ou ne reconnaît pas le libellé brut. */
function dictionaryRulePattern(tx: Transaction): string | null {
  const pattern = merchantPattern(rawLabel(tx));
  return pattern && new RegExp(pattern, 'i').test(rawLabel(tx)) ? pattern : null;
}

export function sanitizeRulePattern(pattern: string, tx: Transaction): string | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 200) return null;
  let re: RegExp;
  try {
    re = new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
  const haystack = tx.normalizedDescription || tx.description || '';
  if (!re.test(haystack)) return null;
  // Refuse universal patterns ('.*', '.+', '\\w+') that would match everything.
  const stripped = trimmed.replace(/[.\\^$*+?()[\]{}|/]/g, '').trim();
  if (stripped.length < 2) return null;
  return trimmed;
}

export { MIN_CONFIDENCE_DEFAULT };

// ── tool schema builder ──────────────────────────────────────────────────────

function buildCategorizeTool(availableCategories: string[]): Anthropic.Tool {
  return {
    name: 'categorize_transactions',
    strict: true,
    description:
      "Renvoie une catégorie suggérée pour chaque transaction (toutes en 'other'), avec un score de confiance et une justification courte en français. Optionnellement une regex réutilisable.",
    input_schema: {
      type: 'object' as const,
      properties: {
        suggestions: {
          type: 'array',
          description: 'Une suggestion par transaction fournie. Conserve l\'id exact.',
          items: {
            type: 'object',
            properties: {
              transactionId: { type: 'string', description: 'id exact de la transaction (UUID)' },
              suggestedCategory: {
                type: 'string',
                enum: availableCategories,
                description: 'Catégorie suggérée — doit appartenir à la liste autorisée',
              },
              confidence: {
                type: 'number',
                description: 'Confiance ∈ [0, 1]. ≥ 0.7 = sûr, 0.5 = plausible, < 0.5 = doute',
              },
              reasoning: { type: 'string', description: 'Justification 1 ligne en français' },
              proposedRulePattern: {
                type: ['string', 'null'],
                description:
                  "Regex insensible à la casse réutilisable (ex: 'CARREFOUR', 'PRELEVT.*COFIDIS'). null si tu n'es pas sûr.",
              },
            },
            required: ['transactionId', 'suggestedCategory', 'confidence', 'reasoning', 'proposedRulePattern'],
            additionalProperties: false,
          },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    },
  };
}
