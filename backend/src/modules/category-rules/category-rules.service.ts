import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJson } from '../../common/atomic-write';
import { CategoryRule, CategoryRuleInput, UserCategory } from '../../models/category-rule.model';
import { Transaction, TransactionCategory } from '../../models/transaction.model';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { EventBusService } from '../events/event-bus.service';

const RULES_FILE = 'category-rules.json';
const USER_CATS_FILE = 'user-categories.json';

const BUILTIN_CATEGORIES: TransactionCategory[] = [
  'income', 'housing', 'transport', 'food', 'health',
  'entertainment', 'subscriptions', 'savings', 'transfers', 'taxes', 'other',
];

@Injectable()
export class CategoryRulesService {
  private readonly logger = new Logger(CategoryRulesService.name);

  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly bus: EventBusService,
  ) {}

  private get rulesPath(): string {
    return path.resolve(this.dataDir.getDataDir(), RULES_FILE);
  }

  private get userCatsPath(): string {
    return path.resolve(this.dataDir.getDataDir(), USER_CATS_FILE);
  }

  async getAll(): Promise<CategoryRule[]> {
    try {
      const content = await fs.promises.readFile(this.rulesPath, 'utf8');
      return JSON.parse(content) as CategoryRule[];
    } catch {
      return [];
    }
  }

  async create(input: CategoryRuleInput): Promise<CategoryRule> {
    this.assertValidPattern(input.pattern, input.flags);
    const all = await this.getAll();
    const now = new Date().toISOString();
    const rule: CategoryRule = {
      id: randomUUID(),
      pattern: input.pattern,
      flags: input.flags ?? 'i',
      category: input.category,
      subcategory: input.subcategory ?? '',
      priority: input.priority ?? 100,
      createdAt: now,
      updatedAt: now,
    };
    all.push(rule);
    await this.persistRules(all);
    this.logger.log(`Created category rule ${rule.id} (${rule.pattern} → ${rule.category})`);
    return rule;
  }

  async update(id: string, input: CategoryRuleInput): Promise<CategoryRule> {
    this.assertValidPattern(input.pattern, input.flags);
    const all = await this.getAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new NotFoundException(`Règle ${id} introuvable`);
    all[idx] = {
      ...all[idx],
      pattern: input.pattern,
      flags: input.flags ?? 'i',
      category: input.category,
      subcategory: input.subcategory ?? '',
      priority: input.priority ?? all[idx].priority,
      updatedAt: new Date().toISOString(),
    };
    await this.persistRules(all);
    return all[idx];
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Règle ${id} introuvable`);
    await this.persistRules(next);
  }

  /**
   * Apply rules in priority order (highest first). The first matching rule wins.
   * Match is performed against transaction.normalizedDescription (or description if missing).
   * Returns a NEW array with possibly mutated transactions.
   */
  async apply(transactions: Transaction[]): Promise<Transaction[]> {
    const rules = await this.getAll();
    if (rules.length === 0) return transactions;
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    const compiled = sorted
      .map((r) => {
        try {
          return { rule: r, re: new RegExp(r.pattern, r.flags) };
        } catch {
          this.logger.warn(`Skipping invalid regex rule ${r.id}: /${r.pattern}/${r.flags}`);
          return null;
        }
      })
      .filter((x): x is { rule: CategoryRule; re: RegExp } => x !== null);

    return transactions.map((tx) => {
      const haystack = tx.normalizedDescription || tx.description || '';
      const hit = compiled.find(({ re }) => re.test(haystack));
      if (!hit) return tx;
      return {
        ...tx,
        category: hit.rule.category as TransactionCategory,
        subcategory: hit.rule.subcategory || tx.subcategory,
      };
    });
  }

  async getUserCategories(): Promise<UserCategory[]> {
    try {
      const content = await fs.promises.readFile(this.userCatsPath, 'utf8');
      return JSON.parse(content) as UserCategory[];
    } catch {
      return [];
    }
  }

  async addUserCategory(name: string): Promise<UserCategory> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Le nom ne peut pas être vide');
    const all = await this.getUserCategories();
    const exists = all.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) return exists;
    const cat: UserCategory = { id: randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
    all.push(cat);
    await atomicWriteJson(this.userCatsPath, all);
    return cat;
  }

  async deleteUserCategory(id: string): Promise<void> {
    const all = await this.getUserCategories();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Catégorie ${id} introuvable`);
    await atomicWriteJson(this.userCatsPath, next);
  }

  /**
   * Returns the merged list of categories available for assignment:
   * built-in + user-defined.
   */
  async getAvailableCategories(): Promise<string[]> {
    const userCats = await this.getUserCategories();
    return [...BUILTIN_CATEGORIES, ...userCats.map((c) => c.name)];
  }

  private assertValidPattern(pattern: string, flags?: string): void {
    try {
      new RegExp(pattern, flags ?? 'i');
    } catch (e) {
      throw new BadRequestException(`Regex invalide : ${(e as Error).message}`);
    }
  }

  private async persistRules(all: CategoryRule[]): Promise<void> {
    await atomicWriteJson(this.rulesPath, all);
    this.bus.emit('category-rules-changed');
  }
}
