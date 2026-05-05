import { AnomalyDetectorService } from './anomaly-detector.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: over.id ?? 'x',
    date: over.date ?? '2026-03-01',
    description: over.description ?? '',
    normalizedDescription: over.normalizedDescription ?? (over.description ?? '').toLowerCase(),
    amount: over.amount ?? 0,
    currency: 'EUR',
    category: over.category ?? 'other',
    subcategory: '',
    isRecurring: over.isRecurring ?? false,
    confidence: 1,
    ...over,
  };
}

function stmt(transactions: Transaction[], month = 3): MonthlyStatement {
  return {
    id: `2026-${String(month).padStart(2, '0')}`,
    month, year: 2026,
    uploadedAt: '', bankName: 'LBP', accountHolder: 'X',
    currency: 'EUR', openingBalance: 0, closingBalance: 0,
    totalCredits: 0, totalDebits: 0, transactions,
    healthScore: { total: 0, breakdown: { savingsRate: 0, expenseControl: 0, debtBurden: 0, cashFlowBalance: 0, irregularSpending: 0 }, trend: 'insufficient_data', claudeComment: '' },
    recurringCredits: [], analysisNarrative: '', externalAccountBalances: [],
  };
}

describe('AnomalyDetectorService', () => {
  const svc = new AnomalyDetectorService();

  describe('duplicates', () => {
    it('flags 2 identical debits within 1 day', () => {
      const a = svc.detect(stmt([
        tx({ id: 'a', date: '2026-03-10', amount: -42.5, description: 'NETFLIX' }),
        tx({ id: 'b', date: '2026-03-11', amount: -42.5, description: 'NETFLIX' }),
      ]));
      const dup = a.find((x) => x.type === 'duplicate');
      expect(dup).toBeDefined();
      expect(dup!.transactionIds.sort()).toEqual(['a', 'b']);
    });

    it('does NOT flag duplicates more than 1 day apart', () => {
      const a = svc.detect(stmt([
        tx({ id: 'a', date: '2026-03-10', amount: -42.5, description: 'NETFLIX' }),
        tx({ id: 'b', date: '2026-03-15', amount: -42.5, description: 'NETFLIX' }),
      ]));
      expect(a.find((x) => x.type === 'duplicate')).toBeUndefined();
    });

    it('does NOT flag debits with different amounts', () => {
      const a = svc.detect(stmt([
        tx({ id: 'a', date: '2026-03-10', amount: -42.5, description: 'NETFLIX' }),
        tx({ id: 'b', date: '2026-03-10', amount: -10, description: 'NETFLIX' }),
      ]));
      expect(a.find((x) => x.type === 'duplicate')).toBeUndefined();
    });
  });

  describe('bank fees', () => {
    it('flags bank fees as info when no prev month', () => {
      const a = svc.detect(stmt([
        tx({ id: '1', date: '2026-03-05', amount: -8.5, description: 'COMMISSION INTERVENTION' }),
      ]));
      const fee = a.find((x) => x.type === 'bank_fee_spike');
      expect(fee).toBeDefined();
      expect(fee!.severity).toBe('info');
    });

    it('flags as warning when fees jump 50%+ vs prev month', () => {
      const prev = stmt([tx({ id: 'p', amount: -10, description: 'FRAIS DE TENUE' })], 2);
      const cur = stmt([
        tx({ id: '1', amount: -8, description: 'COMMISSION INTERVENTION' }),
        tx({ id: '2', amount: -8, description: 'COMMISSION INTERVENTION' }),
      ]);
      const a = svc.detect(cur, prev);
      const fee = a.find((x) => x.type === 'bank_fee_spike');
      expect(fee?.severity).toBe('warning');
    });

    it('flags as warning when fees appear after a clean prev month', () => {
      const prev = stmt([tx({ id: 'p', amount: -100, description: 'CB COURSES' })], 2);
      const cur = stmt([tx({ id: '1', amount: -8, description: 'COMMISSION INTERVENTION' })]);
      const a = svc.detect(cur, prev);
      const fee = a.find((x) => x.type === 'bank_fee_spike');
      expect(fee?.severity).toBe('warning');
    });

    it('returns nothing if no fee at all', () => {
      const a = svc.detect(stmt([tx({ amount: -50, description: 'LIDL' })]));
      expect(a.find((x) => x.type === 'bank_fee_spike')).toBeUndefined();
    });
  });

  describe('large outliers', () => {
    it('flags a 1500€ debit when median is 30€ (50× median)', () => {
      const txs = [
        ...Array.from({ length: 5 }, (_, i) => tx({ id: `s${i}`, amount: -30, description: 'CB ' + i })),
        tx({ id: 'big', amount: -1500, description: 'TRAVAUX' }),
      ];
      const a = svc.detect(stmt(txs));
      const big = a.find((x) => x.type === 'large_outlier');
      expect(big).toBeDefined();
      expect(big!.transactionIds).toEqual(['big']);
    });

    it('does NOT flag a recurring big debit (mortgage)', () => {
      const txs = [
        ...Array.from({ length: 5 }, (_, i) => tx({ id: `s${i}`, amount: -30, description: 'CB ' + i })),
        tx({ id: 'mortgage', amount: -1200, description: 'PRELEVT BNP IMMO', isRecurring: true }),
      ];
      const a = svc.detect(stmt(txs));
      expect(a.find((x) => x.type === 'large_outlier')).toBeUndefined();
    });

    it('does NOT flag a "big" debit below 200 €', () => {
      const txs = [
        ...Array.from({ length: 5 }, (_, i) => tx({ id: `s${i}`, amount: -10, description: 'CB ' + i })),
        tx({ id: 'mid', amount: -150, description: 'CB DECAT' }),
      ];
      const a = svc.detect(stmt(txs));
      expect(a.find((x) => x.type === 'large_outlier')).toBeUndefined();
    });
  });

  it('is deterministic (10 runs identical)', () => {
    const s = stmt([
      tx({ id: '1', amount: -8, description: 'COMMISSION INTERVENTION' }),
      tx({ id: '2', amount: -800, description: 'PRELEVT BNP IMMO', isRecurring: true }),
      tx({ id: '3', date: '2026-03-10', amount: -42.5, description: 'NETFLIX' }),
      tx({ id: '4', date: '2026-03-11', amount: -42.5, description: 'NETFLIX' }),
      ...Array.from({ length: 5 }, (_, i) => tx({ id: `s${i}`, amount: -30, description: 'CB ' + i })),
      tx({ id: 'big', amount: -1500, description: 'TRAVAUX' }),
    ]);
    const ref = svc.detect(s);
    for (let i = 0; i < 10; i++) {
      expect(svc.detect(s)).toEqual(ref);
    }
  });
});
