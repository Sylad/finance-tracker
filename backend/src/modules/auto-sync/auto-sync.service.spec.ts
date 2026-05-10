import { Test } from '@nestjs/testing';
import { AutoSyncService } from './auto-sync.service';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const baseStatement: MonthlyStatement = {
  id: '2026-03',
  month: 3,
  year: 2026,
  uploadedAt: '2026-04-01T00:00:00Z',
  bankName: 'LBP',
  accountHolder: 'Alex Démo',
  currency: 'EUR',
  openingBalance: 1000,
  closingBalance: 900,
  totalCredits: 2500,
  totalDebits: 2600,
  transactions: [],
  healthScore: { total: 70, breakdown: { savingsRate: 50, expenseControl: 60, debtBurden: 70, cashFlowBalance: 50, irregularSpending: 80 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [],
  analysisNarrative: '',
  externalAccountBalances: [],
};

describe('AutoSyncService', () => {
  let svc: AutoSyncService;
  let savings: jest.Mocked<SavingsService>;
  let loans: jest.Mocked<LoansService>;

  beforeEach(async () => {
    savings = {
      getAll: jest.fn(),
      addMovement: jest.fn(),
      removeMovementsForStatement: jest.fn(),
    } as unknown as jest.Mocked<SavingsService>;
    loans = {
      getAll: jest.fn(),
      addOccurrence: jest.fn(),
      removeOccurrencesForStatement: jest.fn(),
    } as unknown as jest.Mocked<LoansService>;
    const mod = await Test.createTestingModule({
      providers: [
        AutoSyncService,
        { provide: SavingsService, useValue: savings },
        { provide: LoansService, useValue: loans },
        {
          provide: LoanSuggestionsService,
          useValue: {
            upsertMany: jest.fn(),
            getPending: jest.fn().mockResolvedValue([]),
            snooze: jest.fn(),
          },
        },
        { provide: StorageService, useValue: { getAllStatements: jest.fn().mockResolvedValue([]) } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(AutoSyncService);
  });

  it('matches savings transactions by regex and adds movements', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'pel-1', name: 'PEL', type: 'pel', initialBalance: 1000, initialBalanceDate: '2026-01-01',
      matchPattern: 'VIR.*PEL', interestRate: 0.02, interestAnniversaryMonth: 6,
      currentBalance: 1000, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      transactions: [
        { id: 'tx1', date: '2026-03-05', description: 'VIR EPARGNE PEL', normalizedDescription: 'vir epargne pel', amount: -100, currency: 'EUR', category: 'savings', subcategory: '', isRecurring: true, confidence: 1 },
        { id: 'tx2', date: '2026-03-12', description: 'COURSES CARREFOUR', normalizedDescription: 'courses carrefour', amount: -42, currency: 'EUR', category: 'food', subcategory: '', isRecurring: false, confidence: 1 },
      ],
    };
    await svc.syncStatement(stmt);
    expect(savings.addMovement).toHaveBeenCalledTimes(1);
    expect(savings.addMovement).toHaveBeenCalledWith('pel-1', expect.objectContaining({
      amount: 100, source: 'detected', statementId: '2026-03', transactionId: 'tx1',
    }));
  });

  it('matches loan transactions by regex and adds occurrences', async () => {
    savings.getAll.mockResolvedValue([]);
    loans.getAll.mockResolvedValue([{
      id: 'loan-1', name: 'Cofidis', type: 'revolving', category: 'consumer',
      monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true, maxAmount: 3000, usedAmount: 1200,
      occurrencesDetected: [], createdAt: '', updatedAt: '',
    }]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      transactions: [
        { id: 'tx1', date: '2026-03-10', description: 'PRELEVT COFIDIS', normalizedDescription: 'prelevt cofidis', amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
      ],
    };
    await svc.syncStatement(stmt);
    expect(loans.addOccurrence).toHaveBeenCalledWith('loan-1', expect.objectContaining({
      statementId: '2026-03', amount: -80, transactionId: 'tx1',
    }));
  });

  it('skips entities with empty matchPattern', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'a', name: 'A', type: 'other', initialBalance: 0, initialBalanceDate: '2026-01-01',
      matchPattern: '', interestRate: 0, interestAnniversaryMonth: 1,
      currentBalance: 0, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    await svc.syncStatement({ ...baseStatement, transactions: [] });
    expect(savings.addMovement).not.toHaveBeenCalled();
  });

  it('catches invalid regex without throwing', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'a', name: 'A', type: 'other', initialBalance: 0, initialBalanceDate: '2026-01-01',
      matchPattern: '[invalid(', interestRate: 0, interestAnniversaryMonth: 1,
      currentBalance: 0, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    await expect(svc.syncStatement({ ...baseStatement, transactions: [{ id: 't', date: '2026-03-01', description: 'X', normalizedDescription: 'x', amount: -1, currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 0 }] })).resolves.not.toThrow();
    expect(savings.addMovement).not.toHaveBeenCalled();
  });

  it('removeForStatement is called for both services', async () => {
    await svc.removeForStatement('2026-03');
    expect(savings.removeMovementsForStatement).toHaveBeenCalledWith('2026-03');
    expect(loans.removeOccurrencesForStatement).toHaveBeenCalledWith('2026-03');
  });

  it('overwrites currentBalance when externalAccountBalances contains a match', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'pel-1', name: 'PEL', type: 'pel', initialBalance: 1000, initialBalanceDate: '2026-01-01',
      matchPattern: 'VIR.*PEL', accountNumber: '12345678', interestRate: 0.02, interestAnniversaryMonth: 6,
      currentBalance: 1500, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      externalAccountBalances: [{ accountNumber: '1234 5678', accountType: 'pel', balance: 1750 }],
      transactions: [],
    };
    await svc.syncStatement(stmt);
    expect(savings.addMovement).toHaveBeenCalledWith('pel-1', expect.objectContaining({
      amount: 250, source: 'bank-extract', statementId: '2026-03',
    }));
  });

  it('matches transactions by targetAccountNumber when no bank-extract', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'livret-1', name: 'Livret A', type: 'livret-a', initialBalance: 100, initialBalanceDate: '2026-01-01',
      matchPattern: '', accountNumber: '99999999', interestRate: 0.015, interestAnniversaryMonth: 12,
      currentBalance: 100, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      externalAccountBalances: [],
      transactions: [
        { id: 'tx1', date: '2026-03-05', description: 'VIREMENT POUR LIVRET', normalizedDescription: 'virement pour livret',
          amount: -50, currency: 'EUR', category: 'savings', subcategory: '', isRecurring: true, confidence: 1,
          targetAccountNumber: '9999 9999' },
      ],
    };
    await svc.syncStatement(stmt);
    expect(savings.addMovement).toHaveBeenCalledWith('livret-1', expect.objectContaining({
      amount: 50, source: 'detected', transactionId: 'tx1',
    }));
  });

  describe('syncLoans — RUM matching on bank statements', () => {
    it('matches loan transaction by rumRefs[] when contractRef absent from description', async () => {
      savings.getAll.mockResolvedValue([]);
      loans.getAll.mockResolvedValue([{
        id: 'loan-cofidis', name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        contractRef: '12345678', // pas dans la description bank
        rumRefs: ['MD2024030500001234'], // appears in bank libellé
        maxAmount: 3000, usedAmount: 1200,
        occurrencesDetected: [], createdAt: '', updatedAt: '',
      }]);
      const stmt: MonthlyStatement = {
        ...baseStatement,
        transactions: [
          { id: 'tx1', date: '2026-03-10', description: 'PRELEVT SEPA COFIDIS REF MD2024030500001234',
            normalizedDescription: 'prelevt sepa cofidis ref md2024030500001234',
            amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
        ],
      };
      await svc.syncStatement(stmt);
      expect(loans.addOccurrence).toHaveBeenCalledWith('loan-cofidis', expect.objectContaining({
        amount: -80, transactionId: 'tx1',
      }));
    });

    it('matches when contractRef OR rumRefs hit (OR-set)', async () => {
      savings.getAll.mockResolvedValue([]);
      loans.getAll.mockResolvedValue([{
        id: 'loan-1', name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        contractRef: 'ABC99999',
        rumRefs: ['SEPA-RUM-001', 'SEPA-RUM-002'],
        maxAmount: 3000, usedAmount: 1200,
        occurrencesDetected: [], createdAt: '', updatedAt: '',
      }]);
      const stmt: MonthlyStatement = {
        ...baseStatement,
        transactions: [
          // Contains contractRef ABC99999 → should match
          { id: 'tx-a', date: '2026-03-10', description: 'PRELEVT COFIDIS ABC99999',
            normalizedDescription: 'prelevt cofidis abc99999',
            amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
          // Contains rumRefs[1] (SEPA-RUM-002) → should also match
          { id: 'tx-b', date: '2026-04-10', description: 'PRELEVT COFIDIS SEPA-RUM-002',
            normalizedDescription: 'prelevt cofidis sepa-rum-002',
            amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
        ],
      };
      await svc.syncStatement(stmt);
      expect(loans.addOccurrence).toHaveBeenCalledTimes(2);
    });

    it('does NOT match when neither contractRef nor any rumRef is in description', async () => {
      savings.getAll.mockResolvedValue([]);
      loans.getAll.mockResolvedValue([{
        id: 'loan-1', name: 'Cofidis', type: 'revolving', category: 'consumer',
        monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true,
        contractRef: 'ABC99999',
        rumRefs: ['SEPA-RUM-001'],
        maxAmount: 3000, usedAmount: 1200,
        occurrencesDetected: [], createdAt: '', updatedAt: '',
      }]);
      const stmt: MonthlyStatement = {
        ...baseStatement,
        transactions: [
          // Cofidis matches matchPattern but no identifier → no match (regex AND identifier required)
          { id: 'tx1', date: '2026-03-10', description: 'PRELEVT COFIDIS ENTIRELY-DIFFERENT-REF',
            normalizedDescription: 'prelevt cofidis entirely-different-ref',
            amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
        ],
      };
      await svc.syncStatement(stmt);
      expect(loans.addOccurrence).not.toHaveBeenCalled();
    });
  });
});
