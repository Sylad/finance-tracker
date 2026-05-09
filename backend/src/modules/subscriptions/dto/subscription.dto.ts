import { BadRequestException } from '@nestjs/common';
import type {
  SubscriptionCategory,
  SubscriptionFrequency,
  SubscriptionInput,
} from '../../../models/subscription.model';

const VALID_FREQUENCIES: SubscriptionFrequency[] = ['monthly', 'quarterly', 'yearly'];
const VALID_CATEGORIES: SubscriptionCategory[] = [
  'streaming',
  'utility',
  'software',
  'membership',
  'telecom',
  'insurance',
  'other',
];

export function validateSubscriptionInput(raw: unknown): SubscriptionInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('Nom requis');

  const frequency = (r.frequency as SubscriptionFrequency) ?? 'monthly';
  if (!VALID_FREQUENCIES.includes(frequency)) {
    throw new BadRequestException(`Fréquence invalide (${frequency})`);
  }

  const category = (r.category as SubscriptionCategory) ?? 'other';
  if (!VALID_CATEGORIES.includes(category)) {
    throw new BadRequestException(`Catégorie invalide (${category})`);
  }

  const monthlyAmount = Number(r.monthlyAmount);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) {
    throw new BadRequestException('monthlyAmount invalide');
  }

  const matchPattern = typeof r.matchPattern === 'string'
    ? r.matchPattern.trim().replace(/^\(\?[a-zA-Z]+\)/, '')
    : '';
  if (matchPattern) {
    try { new RegExp(matchPattern, 'i'); } catch {
      throw new BadRequestException(`matchPattern n'est pas un regex valide: ${matchPattern}`);
    }
  }

  const isActive = r.isActive !== false;
  const creditor = typeof r.creditor === 'string' ? r.creditor.trim() : undefined;
  const contractRef = typeof r.contractRef === 'string' ? r.contractRef.trim() : undefined;

  const startDate = typeof r.startDate === 'string' ? r.startDate : '';
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new BadRequestException('startDate doit être YYYY-MM-DD');
  }
  const endDate = typeof r.endDate === 'string' ? r.endDate : '';
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new BadRequestException('endDate doit être YYYY-MM-DD');
  }

  return {
    name,
    creditor: creditor || undefined,
    monthlyAmount,
    frequency,
    category,
    contractRef: contractRef || undefined,
    matchPattern,
    isActive,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
}
