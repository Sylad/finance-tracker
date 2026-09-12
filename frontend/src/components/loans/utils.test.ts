import { describe, expect, it } from 'vitest';
import type { Loan } from '@/types/api';
import { earlyRepayments, mensualitesCount, monthlyCharge } from './utils';

const loan: Loan = {
  id: 'l', name: 'Cofidis', type: 'revolving', category: 'consumer', monthlyPayment: 186,
  matchPattern: 'COFIDIS', isActive: true, createdAt: '', updatedAt: '',
  occurrencesDetected: [
    { id: 'o1', statementId: '2026-08', date: '2026-08-05', amount: -186, transactionId: 't1', source: 'bank_statement' },
    { id: 'o2', statementId: '2026-08', date: '2026-08-31', amount: -5000, transactionId: 't2', source: 'early_repayment' },
    { id: 'o3', statementId: '2026-08', date: '2026-08-14', amount: 650, transactionId: 't3', source: 'draw' },
  ],
};

describe('earlyRepayments', () => {
  it('ne retourne que les occurrences early_repayment, les plus récentes en premier', () => {
    expect(earlyRepayments(loan).map((o) => o.id)).toEqual(['o2']);
  });
});

describe('mensualitesCount', () => {
  it('compte les débits hors remboursements anticipés et tirages', () => {
    expect(mensualitesCount(loan)).toBe(1);
  });
});

describe('monthlyCharge', () => {
  it('somme les mensualités du mois, hors tirages et hors remboursements anticipés', () => {
    expect(monthlyCharge(loan, '2026-08')).toBe(186);
  });
});
