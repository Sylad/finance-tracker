import { BadRequestException } from '@nestjs/common';
import type { CategoryRuleInput } from '../../../models/category-rule.model';

export function validateCategoryRuleInput(raw: unknown): CategoryRuleInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const pattern = typeof r.pattern === 'string' ? r.pattern.trim() : '';
  if (!pattern) throw new BadRequestException('pattern requis');
  if (pattern.length > 500) throw new BadRequestException('pattern trop long (max 500)');

  const flags = typeof r.flags === 'string' ? r.flags.trim() : 'i';
  if (flags && !/^[gimsuy]{0,8}$/.test(flags)) throw new BadRequestException('flags invalides');

  try { new RegExp(pattern, flags || 'i'); } catch (e) {
    throw new BadRequestException(`Regex invalide : ${(e as Error).message}`);
  }

  const category = typeof r.category === 'string' ? r.category.trim() : '';
  if (!category) throw new BadRequestException('category requise');
  if (category.length > 60) throw new BadRequestException('category trop longue (max 60)');

  const subcategory = typeof r.subcategory === 'string' ? r.subcategory.trim() : '';
  if (subcategory.length > 60) throw new BadRequestException('subcategory trop longue (max 60)');

  const priority = r.priority !== undefined && r.priority !== null ? Number(r.priority) : undefined;
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 10000)) {
    throw new BadRequestException('priority invalide (entier 0..10000)');
  }

  return { pattern, flags: flags || 'i', category, subcategory: subcategory || undefined, priority };
}

export function validateUserCategoryName(raw: unknown): string {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('name requis');
  if (name.length > 60) throw new BadRequestException('name trop long (max 60)');
  return name;
}
