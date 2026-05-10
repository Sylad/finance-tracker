import { BadRequestException } from '@nestjs/common';
import type { LoanCategory, LoanInput, LoanType } from '../../../models/loan.model';

const VALID_TYPES: LoanType[] = ['classic', 'revolving'];
const VALID_CATEGORIES: LoanCategory[] = ['mortgage', 'consumer', 'auto', 'student', 'other'];

export function validateLoanInput(raw: unknown): LoanInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('Nom requis');

  const type = r.type as LoanType;
  if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Type invalide (${type})`);

  const category = r.category as LoanCategory;
  if (!VALID_CATEGORIES.includes(category)) throw new BadRequestException(`Catégorie invalide (${category})`);

  const monthlyPayment = Number(r.monthlyPayment);
  if (!Number.isFinite(monthlyPayment) || monthlyPayment < 0) throw new BadRequestException('monthlyPayment invalide');

  // Strip leading inline flags (?i), (?m), etc. — JavaScript ne supporte pas
  // ces flags inline, on ajoute le flag 'i' au runtime de toute façon.
  const matchPattern = typeof r.matchPattern === 'string'
    ? r.matchPattern.trim().replace(/^\(\?[a-zA-Z]+\)/, '')
    : '';
  if (matchPattern) {
    try { new RegExp(matchPattern, 'i'); } catch {
      throw new BadRequestException(`matchPattern n'est pas un regex valide: ${matchPattern}`);
    }
  }

  const isActive = r.isActive !== false;

  // Optional creditor + contract reference (free text, trimmed)
  const creditor = typeof r.creditor === 'string' ? r.creditor.trim() : undefined;
  const contractRef = typeof r.contractRef === 'string' ? r.contractRef.trim() : undefined;

  // Optional rumRefs[] (SEPA mandate references, dedup + trim)
  let rumRefs: string[] | undefined;
  if (Array.isArray(r.rumRefs)) {
    const cleaned = r.rumRefs
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    rumRefs = cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
  }

  const base: LoanInput = { name, type, category, monthlyPayment, matchPattern, isActive, creditor: creditor || undefined, contractRef: contractRef || undefined, rumRefs };

  if (type === 'classic') {
    const startDate = typeof r.startDate === 'string' ? r.startDate : '';
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('startDate doit être YYYY-MM-DD');
    const endDate = typeof r.endDate === 'string' ? r.endDate : '';
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new BadRequestException('endDate doit être YYYY-MM-DD');
    const initialPrincipal = r.initialPrincipal != null ? Number(r.initialPrincipal) : undefined;
    if (initialPrincipal != null && !Number.isFinite(initialPrincipal)) throw new BadRequestException('initialPrincipal invalide');
    return { ...base, startDate: startDate || undefined, endDate: endDate || undefined, initialPrincipal };
  }

  // revolving
  const maxAmount = Number(r.maxAmount);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) throw new BadRequestException('maxAmount requis pour revolving');
  const usedAmount = r.usedAmount != null ? Number(r.usedAmount) : 0;
  if (!Number.isFinite(usedAmount) || usedAmount < 0) throw new BadRequestException('usedAmount invalide');
  if (usedAmount > maxAmount) throw new BadRequestException('usedAmount > maxAmount');
  return { ...base, maxAmount, usedAmount };
}
