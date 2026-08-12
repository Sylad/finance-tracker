import { Test } from '@nestjs/testing';
import { HealthService, HealthContext } from './health.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SavingsService } from '../savings/savings.service';
import { HealthThresholdsService } from './health-thresholds.service';
import { DEFAULT_THRESHOLDS } from '../../models/health.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { Loan } from '../../models/loan.model';
import { Subscription } from '../../models/subscription.model';
import { SavingsAccount } from '../../models/savings-account.model';
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
  savings?: SavingsAccount[];
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
        provide: SavingsService,
        useValue: {
          getAll: jest.fn().mockResolvedValue(data.savings ?? []),
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
          provide: SavingsService,
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

  it('(c5) reste à vivre : abonnements exclus de depensesCourantes ET soustraits une seule fois de la formule (F4)', () => {
    // Pas de crédit. Revenu 3000. 1 abonnement actif 50 €/mois avec des
    // occurrences bancaires détectées (transactionId présents dans les
    // relevés) + une dépense courante "autre" de 200 €/mois.
    const months = [
      { y: 2026, m: 1 },
      { y: 2026, m: 2 },
      { y: 2026, m: 3 },
    ];
    const subTxIds: string[] = [];
    const statements = months.map(({ y, m }) => {
      const subTxId = `sub-tx-${y}-${m}`;
      subTxIds.push(subTxId);
      return mkStatement(y, m, [
        mkTx(
          `exp-${y}-${m}`,
          `${y}-${String(m).padStart(2, '0')}-05`,
          -200,
          'DEPENSES COURANTES',
        ),
        mkTx(
          subTxId,
          `${y}-${String(m).padStart(2, '0')}-15`,
          -50,
          'NETFLIX ABONNEMENT',
        ),
      ]);
    });
    const subscription: Subscription = {
      id: 'sub-1',
      name: 'Netflix',
      monthlyAmount: 50,
      frequency: 'monthly',
      category: 'streaming',
      matchPattern: 'NETFLIX',
      isActive: true,
      occurrencesDetected: subTxIds.map((txId, i) => ({
        id: `subocc-${i}`,
        statementId: statements[i].id,
        date: statements[i].transactions[1].date,
        amount: -50,
        transactionId: txId,
      })),
      createdAt: '',
      updatedAt: '',
    };
    const ctx = mkCtx({
      statements,
      subscriptions: [subscription],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeResteAVivre(ctx);

    // depensesCourantes hors crédits ET hors occurrences d'abonnements = 200
    expect(block.details.depensesCourantes).toBe(200);
    expect(block.details.abonnementsMensuels).toBe(50);
    // 3000 - 0 (mensualités) - 50 (abos) - 200 (dépenses hors crédits/abos) = 2750
    expect(block.details.resteAVivre).toBe(2750);
  });

  it('(c6) reste à vivre : abonnement inactif → sa tx retombe dans depensesCourantes ET n\'est PAS comptée dans abonnementsMensuels (re-review F4)', () => {
    // Abonnement annulé récemment (isActive: false) mais avec une occurrence
    // encore dans la fenêtre des 3 derniers relevés (le prélèvement a bien
    // été payé). Il ne doit ni gonfler abonnementsMensuels (filtré sur
    // isActive) ni disparaître de depensesCourantes (sinon reste à vivre
    // surestimé silencieusement — résiduel signalé en re-review).
    const months = [
      { y: 2026, m: 1 },
      { y: 2026, m: 2 },
      { y: 2026, m: 3 },
    ];
    const subTxIds: string[] = [];
    const statements = months.map(({ y, m }) => {
      const subTxId = `sub-tx-${y}-${m}`;
      subTxIds.push(subTxId);
      return mkStatement(y, m, [
        mkTx(
          `exp-${y}-${m}`,
          `${y}-${String(m).padStart(2, '0')}-05`,
          -200,
          'DEPENSES COURANTES',
        ),
        mkTx(
          subTxId,
          `${y}-${String(m).padStart(2, '0')}-15`,
          -50,
          'NETFLIX ABONNEMENT (résilié)',
        ),
      ]);
    });
    const subscription: Subscription = {
      id: 'sub-1',
      name: 'Netflix',
      monthlyAmount: 50,
      frequency: 'monthly',
      category: 'streaming',
      matchPattern: 'NETFLIX',
      isActive: false,
      occurrencesDetected: subTxIds.map((txId, i) => ({
        id: `subocc-${i}`,
        statementId: statements[i].id,
        date: statements[i].transactions[1].date,
        amount: -50,
        transactionId: txId,
      })),
      createdAt: '',
      updatedAt: '',
    };
    const ctx = mkCtx({
      statements,
      subscriptions: [subscription],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeResteAVivre(ctx);

    // La tx de l'abonnement résilié (50 €/mois) retombe dans depensesCourantes.
    expect(block.details.depensesCourantes).toBe(250);
    // Aucun abonnement actif → 0.
    expect(block.details.abonnementsMensuels).toBe(0);
    // 3000 - 0 (mensualités) - 0 (abos) - 250 (dépenses) = 2750
    expect(block.details.resteAVivre).toBe(2750);
  });

  describe('opérations neutres (Task 7)', () => {
    it('(n-a) paire crédit +1980.55 / débit -1980.55 à 1 jour → jambe sortante exclue, operationsNeutres = 1980.55', () => {
      const statement = mkStatement(2026, 3, [
        mkTx('credit-1', '2026-03-10', 1980.55, 'VIREMENT REMBOURSEMENT'),
        mkTx('debit-1', '2026-03-11', -1980.55, 'VIREMENT SORTANT'),
        mkTx('autre-1', '2026-03-05', -300, 'DEPENSES COURANTES'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      expect(block.details.depensesCourantes).toBe(300);
      expect(block.details.operationsNeutres).toBe(1980.55);
      expect(block.details.resteAVivre).toBe(2700);
    });

    it('(n-b) 2 débits identiques sans crédit entrant → comptés normalement, operationsNeutres = 0', () => {
      const statement = mkStatement(2026, 3, [
        mkTx('debit-1', '2026-03-05', -500, 'DEPENSE A'),
        mkTx('debit-2', '2026-03-12', -500, 'DEPENSE B'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      expect(block.details.depensesCourantes).toBe(1000);
      expect(block.details.operationsNeutres).toBe(0);
    });

    it('(n-c) paire à 8 jours d\'écart → non appariée, les deux jambes comptées normalement', () => {
      const statement = mkStatement(2026, 3, [
        mkTx('credit-1', '2026-03-01', 800, 'VIREMENT REMBOURSEMENT'),
        mkTx('debit-1', '2026-03-09', -800, 'VIREMENT SORTANT'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      expect(block.details.depensesCourantes).toBe(800);
      expect(block.details.operationsNeutres).toBe(0);
    });

    it('(n-d) crédit entrant seul (aucun débit correspondant) → dépenses courantes inchangées, operationsNeutres = 0', () => {
      const statement = mkStatement(2026, 3, [
        mkTx('credit-1', '2026-03-10', 500, 'VIREMENT REMBOURSEMENT'),
        mkTx('autre-1', '2026-03-05', -200, 'DEPENSES COURANTES'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      expect(block.details.depensesCourantes).toBe(200);
      expect(block.details.operationsNeutres).toBe(0);
    });

    it('(n-e) 2 débits candidats pour 1 crédit de même montant → seul le plus proche en date est apparié', () => {
      const statement = mkStatement(2026, 3, [
        mkTx('credit-1', '2026-03-10', 600, 'VIREMENT REMBOURSEMENT'),
        mkTx('debit-proche', '2026-03-11', -600, 'VIREMENT SORTANT PROCHE'),
        mkTx('debit-loin', '2026-03-15', -600, 'VIREMENT SORTANT LOIN'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      // Seul debit-proche (1 jour d'écart) est apparié et exclu ; debit-loin
      // (5 jours) reste compté normalement dans les dépenses courantes.
      expect(block.details.depensesCourantes).toBe(600);
      expect(block.details.operationsNeutres).toBe(600);
    });

    it("(n-f) débit dont la description matche le matchPattern d'un loan ACTIF → exclu des candidats, pas apparié", () => {
      const loan = mkLoan({
        id: 'loan-1',
        monthlyPayment: 0,
        matchPattern: 'SOFINCO',
        isActive: true,
      });
      const statement = mkStatement(2026, 3, [
        mkTx('credit-1', '2026-03-10', 300, 'VIREMENT REMBOURSEMENT'),
        mkTx('debit-1', '2026-03-11', -300, 'CA CONSUMER SOFINCO PRLV'),
      ]);
      const ctx = mkCtx({
        statements: [statement],
        loans: [loan],
        income: { monthly: 3000, source: 'detected', label: 'Employer' },
      });

      const block = svc.computeResteAVivre(ctx);

      // debit-1 matche le matchPattern d'un loan actif → n'est pas un
      // candidat de paire neutre → reste compté normalement.
      expect(block.details.depensesCourantes).toBe(300);
      expect(block.details.operationsNeutres).toBe(0);
    });
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

  it('(i) plafond revolving à 70 % (entre greenBelowPct 60 et redAbovePct 95) → orange (F2)', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      maxAmount: 1000,
      usedAmount: 700,
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 5000, source: 'detected', label: 'Employer' }, // taux d'effort 0 % → vert
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.details.pireReservePct).toBe(70);
    expect(block.status).toBe('orange');
    expect(block.thresholdHit).toContain('70');
  });

  it("(j) chargeDette : taux d'effort ET plafonds non-verts simultanément → thresholdHit concatène les deux raisons (F9)", () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 800, // 800/2000 = 40 % → orange (orangeAbovePct 33, redAbovePct 50)
      type: 'revolving',
      maxAmount: 1000,
      usedAmount: 700, // 70 % → orange (greenBelowPct 60, redAbovePct 95)
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 2000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.status).toBe('orange');
    expect(block.thresholdHit).not.toBeNull();
    expect(block.thresholdHit).toContain(';');
    expect(block.thresholdHit).toContain("taux d'effort");
    expect(block.thresholdHit).toContain('utilisé à');
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

  it('(c2) flux tirages : occurrence datée pile 90 jours avant → incluse dans la fenêtre (borne inclusive UTC)', () => {
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
          date: daysAgo(90),
          amount: 300,
          transactionId: 'tx1',
          source: 'draw',
        },
      ],
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeFluxTirages(ctx);

    expect(block.details.tiragesMensuels).toBe(100);
    expect(block.status).toBe('orange');
  });

  it('(c3) flux tirages : revolving actif SANS maxAmount avec tirage → compté dans le flux (F1)', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      // Pas de maxAmount : le prédicat de sélection des réserves actives
      // (revolvingsActifs) doit se baser sur getLoanKind, pas sur maxAmount.
      occurrencesDetected: [
        {
          id: 'o1',
          statementId: 's',
          date: daysAgo(10),
          amount: 300,
          transactionId: 'tx1',
          source: 'draw',
        },
      ],
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeFluxTirages(ctx);

    expect(block.details.tiragesMensuels).toBe(100);
    expect(block.status).toBe('orange');
  });

  it('(c4) chargeDette : revolving actif SANS maxAmount → exclu du ratio plafond, pas de crash (F1)', () => {
    const loan = mkLoan({
      id: 'loan-1',
      monthlyPayment: 0,
      type: 'revolving',
      // Pas de maxAmount ni usedAmount.
    });
    const ctx = mkCtx({
      loans: [loan],
      income: { monthly: 3000, source: 'detected', label: 'Employer' },
    });

    const block = svc.computeChargeDette(ctx);

    expect(block.details.pireReservePct).toBe(0);
    expect(block.details.pireReserveNom).toBeNull();
    expect(block.details.utilisationGlobalePct).toBe(0);
    expect(block.status).toBe('green');
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

  it('(d2) trajectoire : 0 réserve active + solde mensuel moyen positif → vert (jamais orange sans réserve)', () => {
    const statements = [
      mkStatement(2026, 1, []),
      mkStatement(2026, 2, []),
      mkStatement(2026, 3, []),
    ].map((st) => ({ ...st, totalCredits: 2500, totalDebits: 2200 })); // solde +300/mois
    const ctx = mkCtx({ loans: [], statements });

    const block = svc.computeTrajectoire(ctx);

    expect(block.status).toBe('green');
    expect(block.thresholdHit).toBeNull();
    expect(block.details.sumUsed).toBe(0);
    expect(block.details.sumProjected).toBe(0);
    expect(block.details.avgMonthlyBalance).toBe(300);
  });

  it('(d3) trajectoire : 0 réserve active + solde mensuel moyen négatif → rouge', () => {
    const statements = [
      mkStatement(2026, 1, []),
      mkStatement(2026, 2, []),
      mkStatement(2026, 3, []),
    ].map((st) => ({ ...st, totalCredits: 2000, totalDebits: 2400 })); // solde -400/mois
    const ctx = mkCtx({ loans: [], statements });

    const block = svc.computeTrajectoire(ctx);

    expect(block.status).toBe('red');
    expect(block.thresholdHit).toContain('négatif');
    expect(block.details.avgMonthlyBalance).toBe(-400);
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

  it("(h2) getDiagnostic : manualMonthlyIncome <= 0 persisté sur disque (contournant le clamp d'écriture) → traité comme indisponible (F3)", async () => {
    const thresholds = structuredClone(DEFAULT_THRESHOLDS);
    thresholds.manualMonthlyIncome = 0;
    const svcH = await mkServiceWith({ thresholds });

    const diag = await svcH.getDiagnostic();

    expect(diag.income.monthly).toBeNull();
    expect(diag.reliability).toBe('unavailable');
    expect(diag.verdict).toBe('orange');
  });

  it("(i) buildContext : virement entrant récurrent d'épargne exclu du calcul du revenu (F7)", async () => {
    const months = [
      { y: 2026, m: 1 },
      { y: 2026, m: 2 },
      { y: 2026, m: 3 },
    ];
    const txIds: string[] = [];
    const statements = months.map(({ y, m }) => {
      const txId = `sav-tx-${y}-${m}`;
      txIds.push(txId);
      return mkStatement(y, m, [
        mkTx(
          txId,
          `${y}-${String(m).padStart(2, '0')}-15`,
          500,
          'Virement vers Livret A',
        ),
      ]);
    });
    const savingsAccount: SavingsAccount = {
      id: 'sav-1',
      name: 'Livret A',
      type: 'livret-a',
      initialBalance: 0,
      initialBalanceDate: '2025-01-01',
      matchPattern: 'LIVRET',
      interestRate: 0.015,
      interestAnniversaryMonth: 12,
      currentBalance: 1500,
      lastSyncedStatementId: null,
      movements: txIds.map((txId, i) => ({
        id: `mv-${i}`,
        date: statements[i].transactions[0].date,
        amount: 500,
        source: 'bank-extract',
        statementId: statements[i].id,
        transactionId: txId,
      })),
      createdAt: '',
      updatedAt: '',
    };
    const svcI = await mkServiceWith({ statements, savings: [savingsAccount] });

    const ctx = await svcI.buildContext();

    // Sans l'exclusion, ce virement stable 3 mois serait détecté comme
    // revenu — avec l'exclusion, aucun autre cluster ne qualifie → unavailable.
    expect(ctx.income.source).toBe('unavailable');
    expect(ctx.income.monthly).toBeNull();
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
