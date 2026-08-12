import { Test } from '@nestjs/testing';
import { HealthService, HealthContext } from './health.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { HealthThresholdsService } from './health-thresholds.service';
import { DEFAULT_THRESHOLDS } from '../../models/health.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { Loan } from '../../models/loan.model';
import { Subscription } from '../../models/subscription.model';
import { HealthThresholds } from '../../models/health.model';

function mkTx(
  id: string,
  date: string,
  amount: number,
  description = 'TX',
): Transaction {
  return {
    id,
    date,
    description,
    normalizedDescription: description.toLowerCase(),
    amount,
    currency: 'EUR',
    category: 'other',
    subcategory: '',
    isRecurring: false,
    confidence: 1,
  };
}

function mkStatement(
  year: number,
  month: number,
  transactions: Transaction[],
): MonthlyStatement {
  return {
    id: `${year}-${String(month).padStart(2, '0')}`,
    month,
    year,
    uploadedAt: '2026-01-01T00:00:00Z',
    bankName: 'LBP',
    accountHolder: 'Test',
    currency: 'EUR',
    openingBalance: 0,
    closingBalance: 0,
    totalCredits: 0,
    totalDebits: 0,
    transactions,
    healthScore: {
      total: 0,
      breakdown: {
        savingsRate: 0,
        expenseControl: 0,
        debtBurden: 0,
        cashFlowBalance: 0,
        irregularSpending: 0,
      },
      trend: 'insufficient_data',
      claudeComment: '',
    },
    recurringCredits: [],
    analysisNarrative: '',
  };
}

function mkLoan(
  over: Partial<Loan> & { id: string; monthlyPayment: number },
): Loan {
  return {
    name: 'Loan',
    type: 'classic',
    category: 'consumer',
    matchPattern: 'X',
    isActive: true,
    occurrencesDetected: [],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

// 3 statements each with one loan-linked debit tx (excluded) + one "current expense" debit tx
// summing to `expensePerMonth`, so the 3-month average of dépenses courantes hors crédits equals expensePerMonth.
function mkThreeStatementsWithExpenses(
  expensePerMonth: number,
  loanTxAmount: number,
): {
  statements: MonthlyStatement[];
  loanTxIds: string[];
} {
  const months = [
    { y: 2026, m: 1 },
    { y: 2026, m: 2 },
    { y: 2026, m: 3 },
  ];
  const loanTxIds: string[] = [];
  const statements = months.map(({ y, m }) => {
    const loanTxId = `loan-tx-${y}-${m}`;
    loanTxIds.push(loanTxId);
    return mkStatement(y, m, [
      mkTx(
        `exp-${y}-${m}`,
        `${y}-${String(m).padStart(2, '0')}-05`,
        -expensePerMonth,
        'DEPENSES COURANTES',
      ),
      mkTx(
        loanTxId,
        `${y}-${String(m).padStart(2, '0')}-10`,
        -loanTxAmount,
        'PRLV CREDIT',
      ),
    ]);
  });
  return { statements, loanTxIds };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function mkServiceWith(data: {
  statements?: MonthlyStatement[];
  loans?: Loan[];
  subscriptions?: Subscription[];
  thresholds?: HealthThresholds;
}): Promise<HealthService> {
  const mod = await Test.createTestingModule({
    providers: [
      HealthService,
      {
        provide: LoansService,
        useValue: { getAll: jest.fn().mockResolvedValue(data.loans ?? []) },
      },
      {
        provide: StorageService,
        useValue: {
          getAllStatements: jest.fn().mockResolvedValue(data.statements ?? []),
        },
      },
      {
        provide: SubscriptionsService,
        useValue: {
          getAll: jest.fn().mockResolvedValue(data.subscriptions ?? []),
        },
      },
      {
        provide: HealthThresholdsService,
        useValue: {
          get: jest
            .fn()
            .mockResolvedValue(
              data.thresholds ?? structuredClone(DEFAULT_THRESHOLDS),
            ),
        },
      },
    ],
  }).compile();
  return mod.get(HealthService);
}

function mkCtx(over: Partial<HealthContext>): HealthContext {
  return {
    statements: [],
    loans: [],
    subscriptions: [],
    thresholds: structuredClone(DEFAULT_THRESHOLDS),
    income: { monthly: null, source: 'unavailable', label: null },
    ...over,
  };
}

describe('HealthService', () => {
  let svc: HealthService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: LoansService,
          useValue: { getAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: StorageService,
          useValue: { getAllStatements: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: SubscriptionsService,
          useValue: { getAll: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: HealthThresholdsService,
          useValue: {
            get: jest
              .fn()
              .mockResolvedValue(structuredClone(DEFAULT_THRESHOLDS)),
          },
        },
      ],
    }).compile();
    svc = mod.get(HealthService);
  });

  it('(a) reste à vivre confortable → vert', () => {
    const loan = mkLoan({ id: 'loan-1', monthlyPayment: 400 });
    const { statements, loanTxIds } = mkThreeStatementsWithExpenses(1500, 400);
    loan.occurrencesDetected = loanTxIds.map((txId, i) => ({
      id: `occ-${i}`,
      statementId: statements[i].id,
      date: statements[i].transactions[1].date,
      amount: -400,
      transactionId: txId,
      source: 'bank_statement',
    }));
    const ctx = mkCtx({
      statements,
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeResteAVivre(ctx);

    expect(block.status).toBe('green');
    expect(block.thresholdHit).toBeNull();
    expect(block.details.resteAVivre).toBe(1100);
    expect(block.details.mensualitesTotal).toBe(400);
    expect(block.details.depensesCourantes).toBe(1500);
  });

  it('(b) reste à vivre négatif → rouge avec thresholdHit explicite', () => {
    // revenu 2000, mensualités 900, dépenses courantes moyennes 1300 → RAV -200
    const loan = mkLoan({ id: 'loan-1', monthlyPayment: 900 });
    const { statements, loanTxIds } = mkThreeStatementsWithExpenses(1300, 900);
    loan.occurrencesDetected = loanTxIds.map((txId, i) => ({
      id: `occ-${i}`,
      statementId: statements[i].id,
      date: statements[i].transactions[1].date,
      amount: -900,
      transactionId: txId,
      source: 'bank_statement',
    }));
    const ctx = mkCtx({
      statements,
      loans: [loan],
      income: { monthly: 2000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeResteAVivre(ctx);

    expect(block.status).toBe('red');
    expect(block.thresholdHit).toContain('< 0');
    expect(block.details.resteAVivre).toBe(-200);
  });

  it('(c) reste à vivre positif mais < 10 % du revenu → orange', () => {
    // revenu 3000, mensualités 700, dépenses courantes moyennes 2200 → RAV 100 (3.3 % du revenu)
    const loan = mkLoan({ id: 'loan-1', monthlyPayment: 700 });
    const { statements, loanTxIds } = mkThreeStatementsWithExpenses(2200, 700);
    loan.occurrencesDetected = loanTxIds.map((txId, i) => ({
      id: `occ-${i}`,
      statementId: statements[i].id,
      date: statements[i].transactions[1].date,
      amount: -700,
      transactionId: txId,
      source: 'bank_statement',
    }));
    const ctx = mkCtx({
      statements,
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeResteAVivre(ctx);

    expect(block.status).toBe('orange');
    expect(block.thresholdHit).toContain('10');
    expect(block.details.resteAVivre).toBe(100);
  });

  it("(d) taux d'effort 40 % → orange, 60 % → rouge", () => {
    const orangeCtx = mkCtx({
      loans: [mkLoan({ id: 'loan-1', monthlyPayment: 800 })], // 800/2000 = 40%
      income: { monthly: 2000, source: 'detected', label: 'Employer' },
    });
    const redCtx = mkCtx({
      loans: [mkLoan({ id: 'loan-1', monthlyPayment: 1200 })], // 1200/2000 = 60%
      income: { monthly: 2000, source: 'detected', label: 'Employer' },
    });

    const orangeBlock = svc.computeChargeDette(orangeCtx);
    const redBlock = svc.computeChargeDette(redCtx);

    expect(orangeBlock.status).toBe('orange');
    expect(orangeBlock.thresholdHit).toContain('40');
    expect(orangeBlock.details.tauxEffortPct).toBe(40);

    expect(redBlock.status).toBe('red');
    expect(redBlock.thresholdHit).toContain('60');
    expect(redBlock.details.tauxEffortPct).toBe(60);
  });

  it("(e) revolving à 96 % du plafond → rouge même avec taux d'effort vert", () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 500,
      type: 'revolving',
      maxAmount: 1000,
      usedAmount: 960,
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 5000, source: 'detected', label: 'Employer' }, // taux d'effort 10 % → vert
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.status).toBe('red');
    expect(block.thresholdHit).toContain('96');
    expect(block.details.pireReserveNom).toBe('Loan');
    expect(block.details.pireReservePct).toBe(96);
  });

  it('(f) seuils personnalisés respectés (orangeAbovePct 20 → 25 % devient orange)', () => {
    const thresholds = structuredClone(DEFAULT_THRESHOLDS);
    thresholds.tauxEffort.orangeAbovePct = 20;
    const loan = mkLoan({ id: 'loan-1', monthlyPayment: 1000 }); // 1000/4000 = 25%
    const ctx = mkCtx({
      loans: [loan],
      thresholds,
      income: { monthly: 4000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.status).toBe('orange');
    expect(block.details.tauxEffortPct).toBe(25);
  });

  it("(g) taux d'effort exactement 50.0 % (borne) → orange, pas rouge", () => {
    const loan = mkLoan({ id: 'loan-1', monthlyPayment: 500 }); // 500/1000 = 50.0%
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 1000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.details.tauxEffortPct).toBe(50);
    expect(block.status).toBe('orange');
    expect(block.thresholdHit).toContain('50');
  });

  it('(h) plafond revolving exactement 95.0 % (borne) → rouge', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 100,
      type: 'revolving',
      maxAmount: 1000,
      usedAmount: 950,
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 5000, source: 'detected', label: 'Employer' }, // taux d'effort 2 % → vert
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.details.pireReservePct).toBe(95);
    expect(block.status).toBe('red');
    expect(block.thresholdHit).toContain('95');
  });

  it('(a) flux tirages : tirages > remboursements sur 3 mois glissants → orange, valeurs exposées dans details', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 5000,
      usedAmount: 1000,
      occurrencesDetected: [
        {
          id: 'o1',
          statementId: 's',
          date: daysAgo(10),
          amount: 300,
          transactionId: 'tx1',
          source: 'draw',
        },
        {
          id: 'o2',
          statementId: 's',
          date: daysAgo(40),
          amount: -90,
          transactionId: 'tx2',
          source: 'bank_statement',
        },
      ],
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeFluxTirages(ctx);

    expect(block.status).toBe('orange');
    expect(block.thresholdHit).not.toBeNull();
    expect(block.details.tiragesMensuels).toBe(100);
    expect(block.details.remboursementsMensuels).toBe(30);
    expect(block.details.flux).toBe(70);
  });

  it('(b) flux tirages : flux > 15 % du revenu → rouge', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 5000,
      usedAmount: 1000,
      occurrencesDetected: [
        {
          id: 'o1',
          statementId: 's',
          date: daysAgo(5),
          amount: 600,
          transactionId: 'tx1',
          source: 'draw',
        },
      ],
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 1000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeFluxTirages(ctx);

    expect(block.status).toBe('red');
    expect(block.thresholdHit).toContain('rouge');
    expect(block.details.flux).toBe(200);
  });

  it('(c) flux tirages : aucune occurrence de tirage → vert', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 5000,
      usedAmount: 1000,
      occurrencesDetected: [
        {
          id: 'o1',
          statementId: 's',
          date: daysAgo(20),
          amount: -50,
          transactionId: 'tx1',
          source: 'bank_statement',
        },
      ],
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeFluxTirages(ctx);

    expect(block.status).toBe('green');
    expect(block.thresholdHit).toBeNull();
    expect(block.details.tiragesMensuels).toBe(0);
  });

  it('(d) trajectoire : revolving 5000/6000 avec trend +400/mois → plafond saturé sous horizon → rouge', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 6000,
      usedAmount: 5000,
      occurrencesDetected: [
        {
          id: 'o1',
          statementId: 's',
          date: daysAgo(5),
          amount: 400,
          transactionId: 'tx1',
          source: 'draw',
        },
        {
          id: 'o2',
          statementId: 's',
          date: daysAgo(35),
          amount: 400,
          transactionId: 'tx2',
          source: 'draw',
        },
        {
          id: 'o3',
          statementId: 's',
          date: daysAgo(65),
          amount: 400,
          transactionId: 'tx3',
          source: 'draw',
        },
      ],
    });
    const ctx = mkCtx({ loans: [loan] });

    const block = svc.computeTrajectoire(ctx);

    expect(block.status).toBe('red');
    expect(block.thresholdHit).not.toBeNull();
    expect(block.details.sumUsed).toBe(5000);
    expect(block.details.sumProjected).toBe(7400);
  });

  it('(e) getDiagnostic : verdict = pire bloc, causes agrégées en ordre fixe (resteAVivre → chargeDette → trajectoire)', async () => {
    const thresholds = structuredClone(DEFAULT_THRESHOLDS);
    thresholds.manualMonthlyIncome = 2000;
    const loanA = mkLoan({ id: 'loan-a', monthlyPayment: 2200 });
    const loanB = mkLoan({
      id: 'loan-b',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 5000,
      usedAmount: 1000,
    });
    const svcE = await mkServiceWith({ loans: [loanA, loanB], thresholds });

    const diag = await svcE.getDiagnostic();

    expect(diag.verdict).toBe('red');
    expect(diag.blocks.resteAVivre.status).toBe('red');
    expect(diag.blocks.chargeDette.status).toBe('red');
    expect(diag.blocks.fluxTirages.status).toBe('green');
    expect(diag.blocks.trajectoire.status).toBe('orange');
    expect(diag.causes).toEqual([
      diag.blocks.resteAVivre.thresholdHit,
      diag.blocks.chargeDette.thresholdHit,
      diag.blocks.trajectoire.thresholdHit,
    ]);
    expect(diag.reliability).toBe('reduced');
  });

  it('(f) getDiagnostic : revenu non configuré → orange, cause unique, reliability unavailable, sans exception', async () => {
    const svcF = await mkServiceWith({});

    const diag = await svcF.getDiagnostic();

    expect(diag.verdict).toBe('orange');
    expect(diag.causes).toEqual([
      'revenus non configurés — diagnostic impossible',
    ]);
    expect(diag.reliability).toBe('unavailable');
    expect(diag.income.monthly).toBeNull();
    expect(diag.blocks.resteAVivre).toEqual({
      status: 'orange',
      thresholdHit: null,
      details: {},
    });
    expect(diag.blocks.chargeDette).toEqual({
      status: 'orange',
      thresholdHit: null,
      details: {},
    });
    expect(diag.blocks.fluxTirages).toEqual({
      status: 'orange',
      thresholdHit: null,
      details: {},
    });
    expect(diag.blocks.trajectoire).toEqual({
      status: 'orange',
      thresholdHit: null,
      details: {},
    });
  });

  it('(g) getDiagnostic : seulement 2 relevés disponibles → reliability reduced', async () => {
    const thresholds = structuredClone(DEFAULT_THRESHOLDS);
    thresholds.manualMonthlyIncome = 2500;
    const { statements } = mkThreeStatementsWithExpenses(500, 0);
    const svcG = await mkServiceWith({
      statements: statements.slice(0, 2),
      thresholds,
    });

    const diag = await svcG.getDiagnostic();

    expect(diag.reliability).toBe('reduced');
    expect(diag.income.monthly).toBe(2500);
  });
});
