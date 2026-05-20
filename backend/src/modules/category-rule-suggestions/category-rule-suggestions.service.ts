import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { atomicWriteJson } from '../../common/atomic-write';
import {
  CategoryRuleSuggestion,
  IncomingCategorySuggestion,
} from '../../models/category-rule-suggestion.model';
import { Transaction } from '../../models/transaction.model';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { EventBusService } from '../events/event-bus.service';
import { StorageService } from '../storage/storage.service';
import { CategoryRulesService } from '../category-rules/category-rules.service';
import { ClaudeUsageService } from '../claude-usage/claude-usage.service';
import { isAuthError, isQuotaError } from '../../common/claude-errors';

const SUGGESTIONS_FILE = 'category-rule-suggestions.json';
const MAX_DESCRIPTIONS_TO_CLAUDE = 60;
const MIN_OCCURRENCES_PER_PATTERN = 2;

/**
 * Tool description envoyé à Claude. Demande un array de suggestions de règles
 * de catégorisation pour les transactions tagged `other`. Claude doit choisir
 * une catégorie cible parmi celles fournies dans le system prompt.
 */
const SUGGEST_RULES_TOOL: Anthropic.Tool = {
  name: 'suggest_category_rules',
  description:
    "Propose des règles de catégorisation pour les transactions actuellement classées 'other'. Chaque règle = un pattern regex + une catégorie cible.",
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description:
                "Pattern regex (case-insensitive) qui doit matcher le LIBELLÉ de plusieurs transactions du lot. PAS de quantifieur '.*' englobant — choisis 1-3 mots-clés distinctifs (ex: 'NETFLIX|NTLX', 'AMAZON', 'AUCHAN|ATAC', 'RATP|NAVIGO'). Échappe les caractères spéciaux regex.",
            },
            category: {
              type: 'string',
              description:
                "Catégorie cible (parmi la liste fournie dans le contexte system).",
            },
            subcategory: {
              type: 'string',
              description:
                "Sous-catégorie courte humaine optionnelle (ex: 'Streaming', 'Courses', 'Transports'). Vide si non pertinent.",
            },
            exampleDescriptions: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Tableau de 2-5 libellés exemples (tels quels) extraits du lot qui matchent ce pattern. Sert à valider que le pattern est juste.',
            },
            occurrenceCount: {
              type: 'integer',
              description:
                'Nombre de transactions distinctes (par libellé unique) qui matchent le pattern dans le lot fourni.',
            },
            rationale: {
              type: 'string',
              description:
                "Justification courte (1 phrase) du choix de catégorie. Ex: 'Service de streaming vidéo = entertainment.'",
            },
          },
          required: ['pattern', 'category', 'exampleDescriptions', 'occurrenceCount'],
        },
      },
    },
    required: ['suggestions'],
  },
};

@Injectable()
export class CategoryRuleSuggestionsService {
  private readonly logger = new Logger(CategoryRuleSuggestionsService.name);
  private readonly client: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
    private readonly storage: StorageService,
    private readonly rules: CategoryRulesService,
    private readonly usage: ClaudeUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('anthropicApiKey'),
    });
  }

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), SUGGESTIONS_FILE);
  }

  async getAll(): Promise<CategoryRuleSuggestion[]> {
    try {
      return JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as CategoryRuleSuggestion[];
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${this.filepath}: ${e?.message ?? err}`);
      }
      return [];
    }
  }

  async getPending(): Promise<CategoryRuleSuggestion[]> {
    return (await this.getAll()).filter((s) => s.status === 'pending' || s.status === 'snoozed');
  }

  /**
   * Génère un lot de suggestions depuis les transactions `other` récentes.
   * Idempotent : les patterns déjà connus (rejected ou accepted) ne sont pas re-suggérés.
   * Retourne le nombre de nouvelles suggestions créées + le total après upsert.
   */
  async generateFromOthers(): Promise<{ created: number; total: number; otherSeen: number }> {
    const all = await this.storage.getAllStatements();
    const others: Transaction[] = [];
    for (const stmt of all) {
      for (const tx of stmt.transactions) {
        if (tx.category === 'other') others.push(tx);
      }
    }

    if (others.length === 0) {
      this.logger.log('No transactions tagged "other" — nothing to suggest.');
      return { created: 0, total: 0, otherSeen: 0 };
    }

    // Group by normalized description, keep occurrence count + 1 raw example.
    const grouped = new Map<string, { example: string; count: number }>();
    for (const tx of others) {
      const key = (tx.normalizedDescription || tx.description || '').toLowerCase().trim();
      if (!key) continue;
      const entry = grouped.get(key);
      if (entry) entry.count++;
      else grouped.set(key, { example: tx.description || key, count: 1 });
    }

    // Keep only those with ≥ MIN_OCCURRENCES, top N by occurrence.
    const sorted = [...grouped.entries()]
      .filter(([, v]) => v.count >= MIN_OCCURRENCES_PER_PATTERN)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, MAX_DESCRIPTIONS_TO_CLAUDE);

    if (sorted.length === 0) {
      this.logger.log(`Found ${others.length} "other" transactions but none with ≥${MIN_OCCURRENCES_PER_PATTERN} occurrences.`);
      return { created: 0, total: 0, otherSeen: others.length };
    }

    const txSummary = sorted
      .map(([, v]) => `${v.count}× ${v.example}`)
      .join('\n');

    const availableCats = await this.rules.getAvailableCategories();

    this.logger.log(`Sending ${sorted.length} unique "other" descriptions to Claude for rule suggestions.`);

    let claudeSuggestions: IncomingCategorySuggestion[] = [];
    try {
      const message = await this.client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        temperature: 0,
        system:
          "Tu es un analyste qui propose des règles de catégorisation pour des transactions bancaires françaises. Les transactions fournies sont actuellement classées 'other' (non catégorisées). Ton but : proposer des regex pattern + catégorie cible pour automatiser leur classification future.\n\n" +
          "Catégories disponibles : " + availableCats.join(', ') + ".\n\n" +
          "RÈGLES :\n" +
          "- Pattern regex SIMPLE et DISTINCTIF (1-3 mots-clés, échappés correctement). Pas de '.*' englobant.\n" +
          "- Une seule catégorie par pattern. Si un libellé est ambigu (ex: PAYPAL : courses ou abonnement ?), ne propose RIEN plutôt qu'une mauvaise règle.\n" +
          "- Ne propose une règle QUE si le pattern matche ≥2 libellés DISTINCTS du lot fourni.\n" +
          "- Si un libellé est unique et imprévisible (ex: 'PRLV CHEZ M. DUPONT 28/02'), n'invente pas de règle.\n" +
          "- exampleDescriptions doit contenir 2-5 libellés EXACTS du lot fourni.\n" +
          "- rationale en français, 1 phrase max.",
        tools: [SUGGEST_RULES_TOOL],
        tool_choice: { type: 'tool', name: 'suggest_category_rules' },
        messages: [{
          role: 'user',
          content:
            `Transactions actuellement 'other' (format: 'N× libellé', triés par fréquence décroissante) :\n\n${txSummary}\n\nPropose les règles de catégorisation pertinentes (zéro à dix maximum). Si rien ne s'auto-catégorise raisonnablement, retourne un array vide.`,
        }],
      });

      this.usage.recordUsage(message.usage.input_tokens, message.usage.output_tokens);

      const block = message.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('Claude renvoyé sans tool_use block');
      }
      const input = block.input as { suggestions?: IncomingCategorySuggestion[] };
      claudeSuggestions = Array.isArray(input.suggestions) ? input.suggestions : [];
    } catch (err) {
      if (isAuthError(err)) {
        throw new HttpException(
          { code: 'CLAUDE_AUTH_ERROR', message: 'Clé API Claude invalide/révoquée — vérifie ANTHROPIC_API_KEY' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (isQuotaError(err)) {
        throw new HttpException('CLAUDE_QUOTA_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
      }
      this.logger.error('Claude suggest call failed', err);
      throw new HttpException('Échec analyse Claude', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Upsert : skip patterns already in CategoryRules (already adopted)
    // OR in existing rejected/accepted suggestions.
    const existing = await this.getAll();
    const knownRules = await this.rules.getAll();
    const knownKeys = new Set<string>();
    for (const r of knownRules) knownKeys.add(this.dedupKey(r.pattern));
    for (const s of existing) {
      if (s.status === 'accepted' || s.status === 'rejected') {
        knownKeys.add(this.dedupKey(s.pattern));
      }
    }

    const now = new Date().toISOString();
    let created = 0;
    for (const sug of claudeSuggestions) {
      const key = this.dedupKey(sug.pattern);
      if (knownKeys.has(key)) continue;
      // Validate regex compiles
      try {
        new RegExp(sug.pattern, 'i');
      } catch {
        this.logger.warn(`Skipping invalid regex from Claude: /${sug.pattern}/`);
        continue;
      }
      existing.push({
        id: randomUUID(),
        pattern: sug.pattern,
        category: sug.category,
        subcategory: sug.subcategory || undefined,
        exampleDescriptions: sug.exampleDescriptions ?? [],
        occurrenceCount: sug.occurrenceCount ?? 0,
        rationale: sug.rationale,
        status: 'pending',
        createdAt: now,
      });
      knownKeys.add(key);
      created++;
    }

    if (created > 0) {
      await this.persist(existing);
      this.logger.log(`Created ${created} new category-rule suggestions.`);
    }

    return { created, total: existing.filter((s) => s.status === 'pending').length, otherSeen: others.length };
  }

  /**
   * Accepter une suggestion : crée la CategoryRule + marque la suggestion accepted.
   * Ne replay PAS les statements existants — c'est à l'utilisateur d'appuyer sur Replay si voulu.
   */
  async accept(id: string): Promise<{ suggestion: CategoryRuleSuggestion; ruleId: string }> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    const sug = all[idx];

    const rule = await this.rules.create({
      pattern: sug.pattern,
      flags: 'i',
      category: sug.category as Transaction['category'],
      subcategory: sug.subcategory,
      priority: 100,
    });

    all[idx] = {
      ...sug,
      status: 'accepted',
      resolvedAt: new Date().toISOString(),
      acceptedAsRuleId: rule.id,
    };
    await this.persist(all);
    return { suggestion: all[idx], ruleId: rule.id };
  }

  async reject(id: string): Promise<CategoryRuleSuggestion> {
    return this.transition(id, 'rejected');
  }

  async snooze(id: string): Promise<CategoryRuleSuggestion> {
    return this.transition(id, 'snoozed');
  }

  async unsnooze(id: string): Promise<CategoryRuleSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = 'pending';
    delete all[idx].resolvedAt;
    await this.persist(all);
    return all[idx];
  }

  private async transition(
    id: string,
    status: CategoryRuleSuggestion['status'],
  ): Promise<CategoryRuleSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = status;
    all[idx].resolvedAt = new Date().toISOString();
    await this.persist(all);
    return all[idx];
  }

  private dedupKey(pattern: string): string {
    return pattern.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private async persist(all: CategoryRuleSuggestion[]): Promise<void> {
    await atomicWriteJson(this.filepath, all);
    this.bus.emit('category-rule-suggestions-changed');
  }
}
