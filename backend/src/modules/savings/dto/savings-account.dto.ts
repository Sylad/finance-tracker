import { BadRequestException } from '@nestjs/common';
import type { SavingsAccountInput, SavingsAccountType } from '../../../models/savings-account.model';

const VALID_TYPES: SavingsAccountType[] = ['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other'];

export function validateSavingsAccountInput(raw: unknown): SavingsAccountInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('Nom requis');

  const type = r.type as SavingsAccountType;
  if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Type invalide (${type})`);

  const initialBalance = Number(r.initialBalance);
  if (!Number.isFinite(initialBalance)) throw new BadRequestException('initialBalance invalide');

  const initialBalanceDate = typeof r.initialBalanceDate === 'string' ? r.initialBalanceDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(initialBalanceDate)) {
    throw new BadRequestException('initialBalanceDate doit être YYYY-MM-DD');
  }

  // Strip leading inline flags (?i), (?m), etc. — JS ne supporte pas, on ajoute 'i' au runtime.
  const matchPattern = typeof r.matchPattern === 'string'
    ? r.matchPattern.trim().replace(/^\(\?[a-zA-Z]+\)/, '')
    : '';
  if (matchPattern) {
    try { new RegExp(matchPattern, 'i'); } catch {
      throw new BadRequestException(`matchPattern n'est pas un regex valide: ${matchPattern}`);
    }
  }

  const accountNumber = typeof r.accountNumber === 'string' ? r.accountNumber.trim() : '';

  const interestRate = Number(r.interestRate);
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 0.5) {
    throw new BadRequestException('interestRate hors plage [0, 0.5]');
  }

  const anniv = Number(r.interestAnniversaryMonth);
  if (!Number.isInteger(anniv) || anniv < 1 || anniv > 12) {
    throw new BadRequestException('interestAnniversaryMonth doit être un entier 1-12');
  }

  return {
    name,
    type,
    initialBalance,
    initialBalanceDate,
    matchPattern,
    accountNumber: accountNumber || undefined,
    interestRate,
    interestAnniversaryMonth: anniv,
  };
}
