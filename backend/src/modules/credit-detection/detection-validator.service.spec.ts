import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DetectionValidatorService } from './detection-validator.service';
import {
  CandidateCluster,
  ClusterClassification,
} from '../../models/credit-detection.model';
import { LoansService, MatchResult } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StorageService } from '../storage/storage.service';
import { EventBusService } from '../events/event-bus.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';

function makeCluster(
  overrides: Partial<CandidateCluster> = {},
): CandidateCluster {
  return {
    key: 'klarni|zoland',
    creditor: 'klarni',
    merchant: 'zoland',
    occurrences: [
      {
        date: '2026-01-10',
        amount: -44.98,
        description: 'Achat CB Klarni*Zoland 4X 1/3',
        transactionId: 'a',
        statementId: '2026-01',
      },
      {
        date: '2026-02-08',
        amount: -44.5,
        description: 'Klarni*Zoland 4X 2/3',
        transactionId: 'b',
        statementId: '2026-02',
      },
      {
        date: '2026-03-07',
        amount: -45.1,
        description: 'Klarni*Zoland 4X 3/3',
        transactionId: 'c',
        statementId: '2026-03',
      },
    ],
    ...overrides,
  };
}

function makeClassification(
  overrides: Partial<ClusterClassification> = {},
): ClusterClassification {
  return {
    classification: 'installment',
    creditor: 'klarni',
    merchant: 'zoland',
    installmentCount: 4,
    confidence: 0.9,
    rationale: 'Trois débits quasi identiques, créancier BNPL Klarna',
    ...overrides,
  };
}

describe('DetectionValidatorService', () => {
  let loansService: jest.Mocked<
    Pick<LoansService, 'findExistingLoan' | 'getAll'>
  >;
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = {
      findExistingLoan: jest.fn().mockResolvedValue(null),
      getAll: jest.fn().mockResolvedValue([]),
    };
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    svc = new DetectionValidatorService(
      loansService as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      {
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as SubscriptionsService,
    );
  });

  it('(a) installment valide (montants dans ±5%, espacement ~28j, 1/mois) -> upsertMany appelé', async () => {
    const cluster = makeCluster();
    const classification = makeClassification();

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [statementId, incoming] =
      loanSuggestionsService.upsertMany.mock.calls[0];
    expect(statementId).toBe('2026-03');
    expect(incoming).toHaveLength(1);
    const suggestion = incoming[0];
    expect(suggestion.label).toBe('4× klarni · zoland');
    expect(suggestion.suggestedType).toBe('loan');
    expect(suggestion.creditor).toBe('klarni');
    expect(suggestion.matchPattern).toBe('klarni');
    expect(suggestion.source).toBe('llm_detection');
    expect(suggestion.monthlyAmount).toBeCloseTo(44.98, 2);
    expect(suggestion.installment).toEqual({
      count: 4,
      merchant: 'zoland',
      occurrenceTxIds: ['a', 'b', 'c'],
      amounts: [44.98, 44.5, 45.1],
      dates: ['2026-01-10', '2026-02-08', '2026-03-07'],
    });
  });

  it('(b) 3 montants tous à >5% les uns des autres (aucune sous-série de 2+) -> pas de suggestion créée', async () => {
    // Fix 1 : depuis le découpage en sous-séries par montant, un cluster
    // n'est plus rejeté en bloc dès qu'un montant diverge (44.98/44.50
    // formeraient désormais une sous-série valide à 2 occurrences). Pour
    // tester le rejet pur, les 3 montants doivent être mutuellement hors
    // tolérance ±5% deux à deux, donc aucune sous-série n'atteint 2 occ.
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2026-01-10',
          amount: -44.98,
          description: 'Klarni*Zoland 1/3',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-08',
          amount: -70.0,
          description: 'Klarni*Zoland 2/3',
          transactionId: 'b',
          statementId: '2026-02',
        },
        {
          date: '2026-03-07',
          amount: -95.0,
          description: 'Klarni*Zoland 3/3',
          transactionId: 'c',
          statementId: '2026-03',
        },
      ],
    });
    const classification = makeClassification();

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(c) 2 occurrences dans le même mois calendaire -> rejeté', async () => {
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2026-01-01',
          amount: -44.98,
          description: 'Klarni*Zoland 1/2',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-01-31',
          amount: -45.02,
          description: 'Klarni*Zoland 2/2',
          transactionId: 'b',
          statementId: '2026-01',
        },
      ],
    });
    const classification = makeClassification({ installmentCount: null });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(d) confidence 0.5 -> low_confidence, aucun appel', async () => {
    const cluster = makeCluster();
    const classification = makeClassification({ confidence: 0.5 });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: false, reason: 'low_confidence' });
    expect(loansService.findExistingLoan).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(e) findExistingLoan match medium (revolving) -> rejeté', async () => {
    const cluster = makeCluster({
      creditor: 'sofinco',
      occurrences: [
        {
          date: '2026-01-10',
          amount: -60,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -60,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'revolving',
      creditor: 'sofinco',
      merchant: null,
      installmentCount: null,
      confidence: 0.8,
    });
    loansService.findExistingLoan.mockResolvedValue({
      loan: { id: 'loan-1' } as unknown as MatchResult['loan'],
      confidence: 'medium',
      reason: 'creditor+amount match',
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result.created).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(f) subscription -> upsertMany appelé avec suggestedType subscription', async () => {
    const cluster = makeCluster({
      creditor: 'netflix',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-05',
          amount: -13.49,
          description: 'NETFLIX.COM',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-05',
          amount: -13.49,
          description: 'NETFLIX.COM',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'subscription',
      creditor: 'netflix',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [statementId, incoming] =
      loanSuggestionsService.upsertMany.mock.calls[0];
    expect(statementId).toBe('2026-02');
    expect(incoming[0].suggestedType).toBe('subscription');
    expect(incoming[0].source).toBe('llm_detection');
    expect(loansService.findExistingLoan).not.toHaveBeenCalled();
  });

  it('(g) not_credit -> rien créé', async () => {
    const cluster = makeCluster();
    const classification = makeClassification({
      classification: 'not_credit',
      confidence: 0.7,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: false, reason: 'not_credit' });
    expect(loansService.findExistingLoan).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(h) cluster avec 3 plans N× entremêlés (montants hétérogènes par sous-série) -> 3 suggestions aux labels distincts', async () => {
    // Reproduit le cas du bench réel : un même creditor|merchant contient
    // 3 plans BNPL distincts joués en parallèle. Montants par sous-série :
    // A=[41.99,42.00] B=[44.98,44.98] C=[51.97,51.98].
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2026-01-05',
          amount: -41.99,
          description: 'Klarni*Zoland A 1/2',
          transactionId: 'a1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-15',
          amount: -44.98,
          description: 'Klarni*Zoland B 1/2',
          transactionId: 'b1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-25',
          amount: -51.97,
          description: 'Klarni*Zoland C 1/2',
          transactionId: 'c1',
          statementId: '2026-01',
        },
        {
          date: '2026-02-04',
          amount: -42.0,
          description: 'Klarni*Zoland A 2/2',
          transactionId: 'a2',
          statementId: '2026-02',
        },
        {
          date: '2026-02-14',
          amount: -44.98,
          description: 'Klarni*Zoland B 2/2',
          transactionId: 'b2',
          statementId: '2026-02',
        },
        {
          date: '2026-02-24',
          amount: -51.98,
          description: 'Klarni*Zoland C 2/2',
          transactionId: 'c2',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({ installmentCount: 3 });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 3 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(3);
    const labels = loanSuggestionsService.upsertMany.mock.calls
      .map(([, incoming]) => incoming[0].label)
      .sort();
    expect(labels).toEqual([
      '3× klarni · zoland (42€)',
      '3× klarni · zoland (44.98€)',
      '3× klarni · zoland (51.97€)',
    ]);
    // labels doivent bien être distincts (désambiguïsation)
    expect(new Set(labels).size).toBe(3);
  });

  it("(i) sous-série d'1 occurrence isolée -> ignorée, les 2 autres sous-séries valides restent créées", async () => {
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2026-01-05',
          amount: -41.99,
          description: 'Klarni*Zoland A 1/2',
          transactionId: 'a1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-15',
          amount: -44.98,
          description: 'Klarni*Zoland B 1/2',
          transactionId: 'b1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-20',
          amount: -90.0,
          description: 'Klarni*Zoland Isolé',
          transactionId: 'x1',
          statementId: '2026-01',
        },
        {
          date: '2026-02-04',
          amount: -42.0,
          description: 'Klarni*Zoland A 2/2',
          transactionId: 'a2',
          statementId: '2026-02',
        },
        {
          date: '2026-02-14',
          amount: -44.98,
          description: 'Klarni*Zoland B 2/2',
          transactionId: 'b2',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({ installmentCount: null });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 2 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(2);
    const allTxIds = loanSuggestionsService.upsertMany.mock.calls.flatMap(
      ([, incoming]) => incoming[0].installment!.occurrenceTxIds,
    );
    expect(allTxIds).not.toContain('x1');
    expect(allTxIds.sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('(j) cluster homogène (1 seule sous-série) -> comportement inchangé, label sans suffixe montant', async () => {
    const cluster = makeCluster();
    const classification = makeClassification();

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].label).toBe('4× klarni · zoland');
    expect(incoming[0].label).not.toMatch(/\(\d/);
  });

  it('(k) sous-série 9 occurrences / 9 mois distincts à montant stable -> routée en subscription, pas installment', async () => {
    // Round 3 fix 1 : une série longue à prix fixe (ex. Prime Video
    // 1.99/mois) n'est pas un paiement en N fois même si le LLM a dit
    // installment. installmentCount volontairement plus petit (4) que le
    // nombre d'occurrences (9) pour prouver que le reroute intervient
    // AVANT le check installmentCount (sinon 'installment_count_exceeded'
    // aurait rejeté la série au lieu de la router en subscription).
    const occurrences = Array.from({ length: 9 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0');
      return {
        date: `2026-${month}-05`,
        amount: -1.99,
        description: 'PRIME VIDEO CHANNELS',
        transactionId: `p${i}`,
        statementId: `2026-${month}`,
      };
    });
    const cluster = makeCluster({
      creditor: 'amazon',
      merchant: 'primevideo',
      occurrences,
    });
    const classification = makeClassification({
      creditor: 'amazon',
      merchant: 'primevideo',
      installmentCount: 4,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].suggestedType).toBe('subscription');
    expect(incoming[0].label).toBe('amazon · primevideo');
    expect(incoming[0].installment).toBeUndefined();
    expect(incoming[0].monthlyAmount).toBeCloseTo(1.99, 2);
  });

  it('(l) sous-série "carrefour" à un montant proche de la mensualité d\'un loan actif "CARREFOUR BANQUE" -> rejetée (existing_loan_payment)', async () => {
    // Round 3 fix 2 : creditor cluster 'carrefour' != creditor loan exact
    // 'CARREFOUR BANQUE' -> findExistingLoan (match exact) ne le voyait
    // pas. Garde fuzzy AVANT findExistingLoan : normalise + containment +
    // montant ±5%.
    loansService.getAll.mockResolvedValue([
      {
        id: 'loan-cb',
        creditor: 'CARREFOUR BANQUE',
        isActive: true,
        monthlyPayment: 221,
      } as unknown as Awaited<ReturnType<LoansService['getAll']>>[number],
    ]);
    const cluster = makeCluster({
      creditor: 'carrefour',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-10',
          amount: -221,
          description: 'CB CARREFOUR BANQUE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -221,
          description: 'CB CARREFOUR BANQUE',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      creditor: 'carrefour',
      merchant: null,
      installmentCount: 12,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({
      created: false,
      reason: 'existing_loan_payment',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(m) sous-série "carrefour" à un montant différent (4.99) de la mensualité du loan actif -> PAS rejetée', async () => {
    loansService.getAll.mockResolvedValue([
      {
        id: 'loan-cb',
        creditor: 'CARREFOUR BANQUE',
        isActive: true,
        monthlyPayment: 221,
      } as unknown as Awaited<ReturnType<LoansService['getAll']>>[number],
    ]);
    const cluster = makeCluster({
      creditor: 'carrefour',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-10',
          amount: -4.99,
          description: 'CB CARREFOUR MARKET',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -4.99,
          description: 'CB CARREFOUR MARKET',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      creditor: 'carrefour',
      merchant: null,
      installmentCount: null,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('(n) hasFuzzyKnownLoanPayment matche aussi un loan clôturé (isActive:false) -> rejetée existing_loan_payment', async () => {
    // Round 5 fix 2 : le garde créancier ne regardait que les loans actifs
    // -> un crédit tracké puis clôturé (ex. LBP Consumer Finance) était
    // re-suggéré. Doit matcher TOUS les loans, actifs ou non.
    loansService.getAll.mockResolvedValue([
      {
        id: 'loan-lbp',
        creditor: 'LBP FINANCE',
        isActive: false,
        monthlyPayment: 36.46,
      } as unknown as Awaited<ReturnType<LoansService['getAll']>>[number],
    ]);
    const cluster = makeCluster({
      creditor: 'lbp',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-10',
          amount: -36.46,
          description: 'PRLV LBP CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -36.46,
          description: 'PRLV LBP CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      creditor: 'lbp',
      merchant: null,
      installmentCount: null,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({
      created: false,
      reason: 'existing_loan_payment',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(o) fraîcheur : dernière occurrence à 90 jours de la date la plus récente -> rejetée series_ended, avant toute autre règle', async () => {
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2025-10-03',
          amount: -44.98,
          description: 'Klarni*Zoland 1/3',
          transactionId: 'a',
          statementId: '2025-10',
        },
        {
          date: '2025-11-02',
          amount: -44.5,
          description: 'Klarni*Zoland 2/3',
          transactionId: 'b',
          statementId: '2025-11',
        },
        {
          date: '2026-01-01',
          amount: -45.1,
          description: 'Klarni*Zoland 3/3',
          transactionId: 'c',
          statementId: '2026-01',
        },
      ],
    });
    const classification = makeClassification();

    const result = await svc.validate(cluster, classification, '2026-04-01');

    expect(result).toEqual({ created: false, reason: 'series_ended' });
    expect(loansService.getAll).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(p) fraîcheur : dernière occurrence à 30 jours de la date la plus récente -> traité normalement', async () => {
    const cluster = makeCluster(); // dernière occurrence 2026-03-07
    const classification = makeClassification();

    // 2026-03-07 + 30j = 2026-04-06
    const result = await svc.validate(cluster, classification, '2026-04-06');

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('(q) suggestion installment porte evidence (occurrences + rationale + lastSeenDate)', async () => {
    const cluster = makeCluster();
    const classification = makeClassification({
      rationale: 'Trois débits BNPL Klarna quasi identiques',
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].evidence).toEqual({
      occurrences: [
        {
          date: '2026-01-10',
          amount: 44.98,
          description: 'Achat CB Klarni*Zoland 4X 1/3',
        },
        {
          date: '2026-02-08',
          amount: 44.5,
          description: 'Klarni*Zoland 4X 2/3',
        },
        {
          date: '2026-03-07',
          amount: 45.1,
          description: 'Klarni*Zoland 4X 3/3',
        },
      ],
      rationale: 'Trois débits BNPL Klarna quasi identiques',
      lastSeenDate: '2026-03-07',
    });
  });

  it('(r) suggestion subscription porte evidence', async () => {
    const cluster = makeCluster({
      creditor: 'netflix',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-05',
          amount: -13.49,
          description: 'NETFLIX.COM',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-05',
          amount: -13.49,
          description: 'NETFLIX.COM',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'subscription',
      creditor: 'netflix',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
      rationale: 'Abonnement mensuel stable',
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].evidence).toEqual({
      occurrences: [
        { date: '2026-01-05', amount: 13.49, description: 'NETFLIX.COM' },
        { date: '2026-02-05', amount: 13.49, description: 'NETFLIX.COM' },
      ],
      rationale: 'Abonnement mensuel stable',
      lastSeenDate: '2026-02-05',
    });
  });

  it('(s) suggestion loan standard (revolving) porte evidence', async () => {
    // 3 mois distincts, 1 occurrence/mois — satisfait le garde de
    // récurrence mensuelle (Round 6 fix) en plus du reste.
    const cluster = makeCluster({
      creditor: 'sofinco',
      occurrences: [
        {
          date: '2026-01-10',
          amount: -60,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -60,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
        {
          date: '2026-03-10',
          amount: -60,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'c',
          statementId: '2026-03',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'revolving',
      creditor: 'sofinco',
      merchant: null,
      installmentCount: null,
      confidence: 0.8,
      rationale: 'Prélèvements réguliers CA Consumer Finance',
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].evidence).toEqual({
      occurrences: [
        { date: '2026-01-10', amount: 60, description: 'CA CONSUMER FINANCE' },
        { date: '2026-02-10', amount: 60, description: 'CA CONSUMER FINANCE' },
        { date: '2026-03-10', amount: 60, description: 'CA CONSUMER FINANCE' },
      ],
      rationale: 'Prélèvements réguliers CA Consumer Finance',
      lastSeenDate: '2026-03-10',
    });
  });

  it('(t) evidence plafonnée aux 12 occurrences les plus récentes (série longue -> subscription)', async () => {
    const occurrences = Array.from({ length: 15 }, (_, i) => {
      const date = new Date(Date.UTC(2025, i, 5)).toISOString().slice(0, 10);
      return {
        date,
        amount: -1.99,
        description: 'PRIME VIDEO CHANNELS',
        transactionId: `p${i}`,
        statementId: date.slice(0, 7),
      };
    });
    const cluster = makeCluster({
      creditor: 'amazon',
      merchant: 'primevideo',
      occurrences,
    });
    const classification = makeClassification({
      creditor: 'amazon',
      merchant: 'primevideo',
      installmentCount: 4,
      rationale: 'Montant stable 1.99€/mois',
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].evidence!.occurrences).toHaveLength(12);
    expect(incoming[0].evidence!.occurrences[0].date).toBe(occurrences[3].date);
    expect(incoming[0].evidence!.lastSeenDate).toBe(occurrences[14].date);
  });

  it('(u) invariant 1 débit/mois : cluster 38 occurrences sur 10 mois (plusieurs/mois), classé revolving -> rejeté loan_multiple_per_month', async () => {
    // Round 6 fix : la branche standard-loan ne vérifiait pas la
    // récurrence mensuelle — un cluster à ~4 occurrences/mois, montants
    // variables, pouvait être suggéré comme crédit malgré l'invariant
    // métier "1 débit/mois max par crédit" (cf CLAUDE.md APEX 06).
    const occurrences: ReturnType<typeof makeCluster>['occurrences'] = [];
    let idx = 0;
    for (let m = 1; m <= 10; m++) {
      const countThisMonth = m <= 8 ? 4 : 3; // 8*4 + 2*3 = 38
      for (let d = 0; d < countThisMonth; d++) {
        idx++;
        const day = String(2 + d * 5).padStart(2, '0');
        const month = String(m).padStart(2, '0');
        occurrences.push({
          date: `2026-${month}-${day}`,
          amount: -(20 + (idx % 7) * 3),
          description: 'SOFINCO PRLV',
          transactionId: `t${idx}`,
          statementId: `2026-${month}`,
        });
      }
    }
    expect(occurrences).toHaveLength(38);
    const cluster = makeCluster({
      creditor: 'sofinco',
      merchant: null,
      occurrences,
    });
    const classification = makeClassification({
      classification: 'revolving',
      creditor: 'sofinco',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({
      created: false,
      reason: 'loan_multiple_per_month',
    });
    expect(loansService.getAll).not.toHaveBeenCalled();
    expect(loansService.findExistingLoan).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(v) invariant 1 débit/mois : cluster 1/mois sur 2 mois seulement -> rejeté loan_insufficient_recurrence', async () => {
    const cluster = makeCluster({
      creditor: 'sofinco',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'classic',
      creditor: 'sofinco',
      merchant: null,
      installmentCount: null,
      confidence: 0.8,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({
      created: false,
      reason: 'loan_insufficient_recurrence',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(w) invariant 1 débit/mois : cluster 1/mois sur 5 mois -> suggestion créée (comportement conservé)', async () => {
    const cluster = makeCluster({
      creditor: 'sofinco2',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
        {
          date: '2026-03-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'c',
          statementId: '2026-03',
        },
        {
          date: '2026-04-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'd',
          statementId: '2026-04',
        },
        {
          date: '2026-05-10',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'e',
          statementId: '2026-05',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'revolving',
      creditor: 'sofinco2',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('(x) stabilité du jour du mois : occurrences les 3, 5, 4, 6 du mois -> OK, suggestion créée', async () => {
    // Décalages week-ends/fériés typiques — médiane 4.5, écarts max 1.5j,
    // largement sous MAX_DAY_OF_MONTH_DRIFT (5j).
    const cluster = makeCluster({
      creditor: 'sofinco3',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-03',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-05',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
        {
          date: '2026-03-04',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'c',
          statementId: '2026-03',
        },
        {
          date: '2026-04-06',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'd',
          statementId: '2026-04',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'classic',
      creditor: 'sofinco3',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('(y) stabilité du jour du mois : occurrences les 5, 18, 27 du mois -> rejetée loan_irregular_day', async () => {
    const cluster = makeCluster({
      creditor: 'sofinco4',
      merchant: null,
      occurrences: [
        {
          date: '2026-01-05',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-18',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'b',
          statementId: '2026-02',
        },
        {
          date: '2026-03-27',
          amount: -100,
          description: 'CA CONSUMER FINANCE',
          transactionId: 'c',
          statementId: '2026-03',
        },
      ],
    });
    const classification = makeClassification({
      classification: 'revolving',
      creditor: 'sofinco4',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({
      created: false,
      reason: 'loan_irregular_day',
    });
    expect(loansService.getAll).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(z) fraîcheur PAR sous-série : cluster "carrefour" 2 sous-séries (une vivante, une morte) -> 1 seule suggestion créée', async () => {
    // Round 7 fix 1 : reproduit le scan réel — le garde cluster-niveau de
    // validate() ne voit que la date max globale (juillet, portée par la
    // sous-série vivante 4.99€) et laissait donc passer la sous-série
    // morte 9.79€ (dernière occurrence en novembre 2025).
    const aliveOccurrences = [
      {
        date: '2026-05-05',
        amount: -4.99,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'alive-1',
        statementId: '2026-05',
      },
      {
        date: '2026-06-05',
        amount: -4.99,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'alive-2',
        statementId: '2026-06',
      },
      {
        date: '2026-07-05',
        amount: -4.99,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'alive-3',
        statementId: '2026-07',
      },
    ];
    const deadOccurrences = [
      {
        date: '2025-09-26',
        amount: -9.79,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'dead-1',
        statementId: '2025-09',
      },
      {
        date: '2025-10-26',
        amount: -9.79,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'dead-2',
        statementId: '2025-10',
      },
      {
        date: '2025-11-26',
        amount: -9.79,
        description: 'CB CARREFOUR MARKET',
        transactionId: 'dead-3',
        statementId: '2025-11',
      },
    ];
    const cluster = makeCluster({
      creditor: 'carrefour',
      merchant: null,
      occurrences: [...aliveOccurrences, ...deadOccurrences],
    });
    const classification = makeClassification({
      creditor: 'carrefour',
      merchant: null,
      installmentCount: null,
    });

    // Date la plus récente observée sur tous les relevés — proche de la
    // dernière occurrence vivante (10j), donc le garde cluster-niveau ne
    // rejette PAS d'emblée (early-exit économe préservé).
    const result = await svc.validate(cluster, classification, '2026-07-15');

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].monthlyAmount).toBeCloseTo(4.99, 2);
  });

  it('(aa) installmentCount fabriqué par le LLM (8×) sur un plan à 2 occurrences observées -> normalisé à null, label utilise le nombre observé', async () => {
    // Round 8 fix 1 : cas réel — qwen3 a inventé "8×" (puis "6×") pour des
    // plans Klarna qui étaient en réalité des 3× (vérité Zalando confirmée
    // par l'utilisateur). 8 n'appartient pas à {2,3,4,5,6,10,12} -> null.
    const cluster = makeCluster({
      occurrences: [
        {
          date: '2026-01-10',
          amount: -44.98,
          description: 'Klarni*Zoland 1/3',
          transactionId: 'a',
          statementId: '2026-01',
        },
        {
          date: '2026-02-08',
          amount: -44.5,
          description: 'Klarni*Zoland 2/3',
          transactionId: 'b',
          statementId: '2026-02',
        },
      ],
    });
    const classification = makeClassification({ installmentCount: 8 });

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].installment!.count).toBeNull();
    expect(incoming[0].label).toBe('2× klarni · zoland');
    expect(incoming[0].label).not.toContain('8×');
  });
});

describe('DetectionValidatorService.normalizeInstallmentCount (Round 8 fix 1 — fonction pure, accès direct)', () => {
  // normalizeInstallmentCount est `private static` : accès via cast pour
  // verrouiller exactement la matrice de cas demandée, y compris
  // count=12/observées=11 qui n'est pas atteignable en bout en bout via
  // validate() (11 occurrences déclenchent le reroute vers subscription à
  // LONG_SERIES_SUBSCRIPTION_MIN_OCCURRENCES=6, avant tout usage du count).
  const normalize = (
    DetectionValidatorService as unknown as {
      normalizeInstallmentCount: (
        rawCount: number | null,
        observedCount: number,
      ) => number | null;
    }
  ).normalizeInstallmentCount;

  it('count 8 (hors {2,3,4,5,6,10,12}) avec 2 occurrences observées -> null', () => {
    expect(normalize(8, 2)).toBeNull();
  });

  it('count 3 (dans la liste, sous le plafond observées+2) avec 2 occurrences observées -> conservé', () => {
    expect(normalize(3, 2)).toBe(3);
  });

  it('count 12 (dans la liste, sous le plafond observées+2) avec 11 occurrences observées -> conservé', () => {
    expect(normalize(12, 11)).toBe(12);
  });

  it('count null -> null', () => {
    expect(normalize(null, 5)).toBeNull();
  });

  it('count dans la liste mais > observées + 2 (ex. 12 avec 2 observées) -> null', () => {
    expect(normalize(12, 2)).toBeNull();
  });
});

describe('DetectionValidatorService (intégration — vrai LoanSuggestionsService, tmpdir)', () => {
  // Round 2 fix : le round 1 (sous-séries de montants) était correct au
  // niveau du validateur (createdCount:3) mais annulé en aval par
  // LoanSuggestionsService.dedupKey, qui clé par creditor seul —
  // chaque upsertMany successif écrasait le précédent. Reproduit ici avec
  // le VRAI LoanSuggestionsService (pas de mock, tmpdir comme
  // loan-suggestions.service.spec.ts) pour verrouiller le comportement de
  // bout en bout.
  let svc: DetectionValidatorService;
  let loanSuggestionsService: LoanSuggestionsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-detval-'));
    const mod = await Test.createTestingModule({
      providers: [
        DetectionValidatorService,
        LoanSuggestionsService,
        LoansService,
        SubscriptionsService,
        {
          provide: RequestDataDirService,
          useValue: {
            getDataDir: () => tmpDir,
            isDemoMode: () => false,
            runWith: (_ctx: unknown, fn: () => unknown) => fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: StorageService,
          useValue: { getAllStatements: jest.fn(async () => []) },
        },
      ],
    }).compile();
    svc = mod.get(DetectionValidatorService);
    loanSuggestionsService = mod.get(LoanSuggestionsService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('cluster à 3 sous-séries -> validate createdCount:3 ET getPending() retourne 3 suggestions à labels distincts ; re-scan identique -> toujours 3', async () => {
    const cluster: CandidateCluster = {
      key: 'klarni|zoland',
      creditor: 'klarni',
      merchant: 'zoland',
      occurrences: [
        {
          date: '2026-01-05',
          amount: -41.99,
          description: 'Klarni*Zoland A 1/2',
          transactionId: 'a1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-15',
          amount: -44.98,
          description: 'Klarni*Zoland B 1/2',
          transactionId: 'b1',
          statementId: '2026-01',
        },
        {
          date: '2026-01-25',
          amount: -51.97,
          description: 'Klarni*Zoland C 1/2',
          transactionId: 'c1',
          statementId: '2026-01',
        },
        {
          date: '2026-02-04',
          amount: -42.0,
          description: 'Klarni*Zoland A 2/2',
          transactionId: 'a2',
          statementId: '2026-02',
        },
        {
          date: '2026-02-14',
          amount: -44.98,
          description: 'Klarni*Zoland B 2/2',
          transactionId: 'b2',
          statementId: '2026-02',
        },
        {
          date: '2026-02-24',
          amount: -51.98,
          description: 'Klarni*Zoland C 2/2',
          transactionId: 'c2',
          statementId: '2026-02',
        },
      ],
    };
    const classification: ClusterClassification = {
      classification: 'installment',
      creditor: 'klarni',
      merchant: 'zoland',
      installmentCount: 3,
      confidence: 0.9,
      rationale: 'Trois plans BNPL entremêlés',
    };

    const result = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );

    expect(result).toEqual({ created: true, createdCount: 3 });
    const pending = await loanSuggestionsService.getPending();
    expect(pending).toHaveLength(3);
    expect(new Set(pending.map((p) => p.label)).size).toBe(3);

    // re-scan (2e validate identique) -> toujours 3, pas 6
    const result2 = await svc.validate(
      cluster,
      classification,
      cluster.occurrences[cluster.occurrences.length - 1].date,
    );
    expect(result2).toEqual({ created: true, createdCount: 3 });
    const pendingAfterRescan = await loanSuggestionsService.getPending();
    expect(pendingAfterRescan).toHaveLength(3);
  });
});

describe('DetectionValidatorService — gardes créancier existant croisent cluster.creditor (backlog revue 2026-08-13 #2)', () => {
  // Le creditor renvoyé par le LLM peut diverger de l'alias déterministe du
  // cluster (ex. LLM « finazur » alors que le clustering a extrait
  // « credimax financement » du libellé) : les deux gardes doivent tester
  // les DEUX noms, sinon la divergence bypasse la garde -> suggestion doublon.
  // Données synthétiques uniquement.
  type LoanRow = Awaited<ReturnType<LoansService['getAll']>>[number];
  let loansService: jest.Mocked<
    Pick<LoansService, 'findExistingLoan' | 'getAll'>
  >;
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = {
      findExistingLoan: jest.fn().mockResolvedValue(null),
      getAll: jest.fn().mockResolvedValue([]),
    };
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    svc = new DetectionValidatorService(
      loansService as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      {
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as SubscriptionsService,
    );
  });

  function monthlyOccurrences(
    months: string[],
    amount: number,
    description: string,
  ) {
    return months.map((m, i) => ({
      date: `${m}-10`,
      amount: -amount,
      description,
      transactionId: `tx-${i}`,
      statementId: m,
    }));
  }

  const revolvingCluster = () =>
    makeCluster({
      key: 'credimax financement',
      creditor: 'credimax financement',
      merchant: null,
      occurrences: monthlyOccurrences(
        ['2026-01', '2026-02', '2026-03'],
        73.2,
        'PRLV CREDIMAX FINANCEMENT',
      ),
    });
  const revolvingClassification = () =>
    makeClassification({
      classification: 'revolving',
      creditor: 'finazur',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

  const installmentCluster = () =>
    makeCluster({
      key: 'credimax financement|zoland',
      creditor: 'credimax financement',
      merchant: 'zoland',
      occurrences: monthlyOccurrences(
        ['2026-01', '2026-02'],
        51.3,
        'CREDIMAX*ZOLAND 3X',
      ),
    });
  const installmentClassification = () =>
    makeClassification({
      creditor: 'finazur',
      merchant: 'zoland',
      installmentCount: 3,
    });

  const existingLoan = (monthlyPayment: number) =>
    ({
      id: 'loan-synth',
      creditor: 'CREDIMAX FINANCEMENT',
      isActive: true,
      monthlyPayment,
    }) as unknown as LoanRow;

  it('garde fuzzy (revolving) : creditor LLM divergent mais cluster.creditor contenu dans le loan -> existing_loan_payment', async () => {
    loansService.getAll.mockResolvedValue([existingLoan(73.2)]);
    const cluster = revolvingCluster();

    const result = await svc.validate(
      cluster,
      revolvingClassification(),
      '2026-03-10',
    );

    expect(result).toEqual({ created: false, reason: 'existing_loan_payment' });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('garde fuzzy (installment) : creditor LLM divergent mais cluster.creditor contenu dans le loan -> existing_loan_payment', async () => {
    loansService.getAll.mockResolvedValue([existingLoan(51.3)]);

    const result = await svc.validate(
      installmentCluster(),
      installmentClassification(),
      '2026-02-10',
    );

    expect(result).toEqual({ created: false, reason: 'existing_loan_payment' });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('garde fuzzy : cluster.creditor connu mais montant hors ±5 % -> pas rejeté par cette garde', async () => {
    loansService.getAll.mockResolvedValue([existingLoan(300)]);

    const result = await svc.validate(
      revolvingCluster(),
      revolvingClassification(),
      '2026-03-10',
    );

    expect(result).toEqual({ created: true });
  });

  const matchOnlyOnClusterCreditor = (creditor?: string | null) =>
    Promise.resolve(
      creditor === 'credimax financement'
        ? {
            loan: { id: 'loan-synth' } as unknown as MatchResult['loan'],
            confidence: 'medium' as const,
            reason: 'creditor+amount match',
          }
        : null,
    );

  it('findExistingLoan (revolving) : interrogé aussi avec cluster.creditor -> existing_loan_match', async () => {
    loansService.findExistingLoan.mockImplementation((signals) =>
      matchOnlyOnClusterCreditor(signals.creditor),
    );

    const result = await svc.validate(
      revolvingCluster(),
      revolvingClassification(),
      '2026-03-10',
    );

    expect(result).toEqual({ created: false, reason: 'existing_loan_match' });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('findExistingLoan (installment) : interrogé aussi avec cluster.creditor -> existing_loan_match', async () => {
    loansService.findExistingLoan.mockImplementation((signals) =>
      matchOnlyOnClusterCreditor(signals.creditor),
    );

    const result = await svc.validate(
      installmentCluster(),
      installmentClassification(),
      '2026-02-10',
    );

    expect(result).toEqual({ created: false, reason: 'existing_loan_match' });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('findExistingLoan : un seul appel quand creditor LLM et cluster.creditor sont identiques (casse/espaces ignorés)', async () => {
    const cluster = revolvingCluster();
    const classification = makeClassification({
      classification: 'revolving',
      creditor: ' Credimax Financement ',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: true });
    expect(loansService.findExistingLoan).toHaveBeenCalledTimes(1);
  });
});

describe('DetectionValidatorService — branche subscription déterministe + anti-re-suggestion (backlog revue 2026-08-13 #3)', () => {
  // Données synthétiques uniquement (créanciers fictifs).
  type SuggestionRow = Awaited<
    ReturnType<LoanSuggestionsService['getAll']>
  >[number];
  type SubscriptionRow = Awaited<
    ReturnType<SubscriptionsService['getAll']>
  >[number];
  let loansService: jest.Mocked<
    Pick<LoansService, 'findExistingLoan' | 'getAll'>
  >;
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let subscriptionsService: jest.Mocked<Pick<SubscriptionsService, 'getAll'>>;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = {
      findExistingLoan: jest.fn().mockResolvedValue(null),
      getAll: jest.fn().mockResolvedValue([]),
    };
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    subscriptionsService = { getAll: jest.fn().mockResolvedValue([]) };
    svc = new DetectionValidatorService(
      loansService as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      subscriptionsService as unknown as SubscriptionsService,
    );
  });

  const occ = (date: string, amount: number, i: number) => ({
    date,
    amount: -amount,
    description: 'PRLV STREAMIO',
    transactionId: `s-${i}`,
    statementId: date.slice(0, 7),
  });

  const subscriptionCluster = (dates: string[], amount = 9.99) =>
    makeCluster({
      key: 'streamio',
      creditor: 'streamio',
      merchant: null,
      occurrences: dates.map((d, i) => occ(d, amount, i)),
    });

  const subscriptionClassification = (creditor = 'streamio') =>
    makeClassification({
      classification: 'subscription',
      creditor,
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

  const suggestion = (
    overrides: Partial<SuggestionRow> = {},
  ): SuggestionRow => ({
    id: 'sug-synth',
    label: 'streamio',
    monthlyAmount: 9.99,
    occurrencesSeen: 2,
    firstSeenStatementId: '2025-11',
    firstSeenDate: '2025-11-05',
    lastSeenDate: '2025-12-05',
    suggestedType: 'subscription',
    matchPattern: 'streamio',
    creditor: 'streamio',
    status: 'rejected',
    createdAt: '2025-12-06T00:00:00.000Z',
    ...overrides,
  });

  it("2 occurrences à 4 jours d'écart dans le même mois -> rejetée subscription_insufficient_recurrence", async () => {
    const cluster = subscriptionCluster(['2026-02-03', '2026-02-07']);

    const result = await svc.validate(
      cluster,
      subscriptionClassification(),
      '2026-02-07',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_insufficient_recurrence',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('1 seule occurrence -> rejetée subscription_insufficient_recurrence', async () => {
    const result = await svc.validate(
      subscriptionCluster(['2026-02-03']),
      subscriptionClassification(),
      '2026-02-03',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_insufficient_recurrence',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it("2 mois distincts mais 4 jours d'écart (30/01 -> 03/02) -> rejetée subscription_interval_out_of_range", async () => {
    const result = await svc.validate(
      subscriptionCluster(['2026-01-30', '2026-02-03']),
      subscriptionClassification(),
      '2026-02-03',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_interval_out_of_range',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('3 mois avec espacement mensuel (~30 j) -> suggestion subscription créée', async () => {
    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-04', '2026-03-06']),
      subscriptionClassification(),
      '2026-03-06',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].suggestedType).toBe('subscription');
  });

  it.each(['rejected', 'snoozed'] as const)(
    'suggestion déjà %s (même créancier, montant ±5 %%) -> rejetée subscription_already_dismissed',
    async (status) => {
      loanSuggestionsService.getAll.mockResolvedValue([
        suggestion({ status, monthlyAmount: 10.2 }),
      ]);

      const result = await svc.validate(
        subscriptionCluster(['2026-01-05', '2026-02-05']),
        subscriptionClassification(),
        '2026-02-05',
      );

      expect(result).toEqual({
        created: false,
        reason: 'subscription_already_dismissed',
      });
      expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
    },
  );

  it("suggestion refusée sous l'alias déterministe : creditor LLM divergent mais cluster.creditor = créancier refusé -> rejetée", async () => {
    loanSuggestionsService.getAll.mockResolvedValue([suggestion()]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification('videoflux media'),
      '2026-02-05',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_already_dismissed',
    });
  });

  it('suggestion refusée avec alias LLM contenu (« streamio » vs « streamio premium ») -> rejetée (containment fuzzy)', async () => {
    loanSuggestionsService.getAll.mockResolvedValue([
      suggestion({ creditor: 'Streamio Premium' }),
    ]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification(),
      '2026-02-05',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_already_dismissed',
    });
  });

  it('suggestion refusée mais montant hors ±5 % -> PAS bloquée (autre série)', async () => {
    loanSuggestionsService.getAll.mockResolvedValue([
      suggestion({ monthlyAmount: 19.99 }),
    ]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification(),
      '2026-02-05',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
  });

  it('suggestion pending du même créancier -> PAS bloquée (mise à jour par upsertMany)', async () => {
    loanSuggestionsService.getAll.mockResolvedValue([
      suggestion({ status: 'pending' }),
    ]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification(),
      '2026-02-05',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('abonnement déjà suivi (creditor fuzzy, montant ±5 %) -> rejetée existing_subscription', async () => {
    subscriptionsService.getAll.mockResolvedValue([
      {
        id: 'sub-synth',
        name: 'Abonnement vidéo',
        creditor: 'STREAMIO SAS',
        monthlyAmount: 9.99,
        isActive: false,
      } as unknown as SubscriptionRow,
    ]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification(),
      '2026-02-05',
    );

    expect(result).toEqual({
      created: false,
      reason: 'existing_subscription',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('abonnement déjà suivi sans creditor, reconnu par son nom -> rejetée existing_subscription', async () => {
    subscriptionsService.getAll.mockResolvedValue([
      {
        id: 'sub-synth',
        name: 'Streamio',
        monthlyAmount: 9.99,
        isActive: true,
      } as unknown as SubscriptionRow,
    ]);

    const result = await svc.validate(
      subscriptionCluster(['2026-01-05', '2026-02-05']),
      subscriptionClassification(),
      '2026-02-05',
    );

    expect(result).toEqual({
      created: false,
      reason: 'existing_subscription',
    });
  });

  it('série longue reroutée en subscription : anti-re-suggestion appliquée aussi', async () => {
    loanSuggestionsService.getAll.mockResolvedValue([suggestion()]);
    const months = ['01', '02', '03', '04', '05', '06'];
    const cluster = subscriptionCluster(months.map((m) => `2026-${m}-05`));
    const classification = makeClassification({
      classification: 'installment',
      creditor: 'streamio',
      merchant: null,
      installmentCount: null,
    });

    const result = await svc.validate(cluster, classification, '2026-06-05');

    expect(result).toEqual({
      created: false,
      reason: 'subscription_already_dismissed',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });
});

describe('DetectionValidatorService — cluster.creditor = premier mot du libellé : correspondance par mot entier (relecture du lot)', () => {
  // cluster.creditor vient de parseCounterpart (premier mot du libellé
  // nettoyé) : souvent 2-3 lettres ou un mot générique. Il ne doit matcher
  // un créancier connu que par MOT ENTIER (≥ 4 caractères), sinon égalité
  // stricte ; les mots génériques sont ignorés. Noms fictifs uniquement.
  type LoanRow = Awaited<ReturnType<LoansService['getAll']>>[number];
  type SubscriptionRow = Awaited<
    ReturnType<SubscriptionsService['getAll']>
  >[number];
  let loansService: jest.Mocked<
    Pick<LoansService, 'findExistingLoan' | 'getAll'>
  >;
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let subscriptionsService: jest.Mocked<Pick<SubscriptionsService, 'getAll'>>;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = {
      findExistingLoan: jest.fn().mockResolvedValue(null),
      getAll: jest.fn().mockResolvedValue([]),
    };
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    subscriptionsService = { getAll: jest.fn().mockResolvedValue([]) };
    svc = new DetectionValidatorService(
      loansService as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      subscriptionsService as unknown as SubscriptionsService,
    );
  });

  const occurrencesFor = (
    months: string[],
    amount: number,
    description: string,
  ) =>
    months.map((m, i) => ({
      date: `${m}-10`,
      amount: -amount,
      description,
      transactionId: `w-${i}`,
      statementId: m,
    }));

  const loan = (creditor: string, monthlyPayment: number) =>
    ({
      id: `loan-${creditor}`,
      creditor,
      isActive: true,
      monthlyPayment,
    }) as unknown as LoanRow;

  const revolving = (clusterCreditor: string, llmCreditor: string) => ({
    cluster: makeCluster({
      key: clusterCreditor,
      creditor: clusterCreditor,
      merchant: null,
      occurrences: occurrencesFor(
        ['2026-01', '2026-02', '2026-03'],
        88.4,
        `PRLV ${llmCreditor.toUpperCase()}`,
      ),
    }),
    classification: makeClassification({
      classification: 'revolving',
      creditor: llmCreditor,
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    }),
  });

  it('crédit revolving : jeton court « xo » contenu dans « Maxo Banque » (prêt connu à ±5 %) -> suggestion créée', async () => {
    loansService.getAll.mockResolvedValue([loan('Maxo Banque', 88.4)]);
    const { cluster, classification } = revolving('xo', 'xo conso finance');

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: true });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('plan N× : jeton court « la » contenu dans « Plarno » (prêt connu à ±5 %) -> suggestion créée', async () => {
    loansService.getAll.mockResolvedValue([loan('Plarno', 31.5)]);
    const cluster = makeCluster({
      key: 'la|zoland',
      creditor: 'la',
      merchant: 'zoland',
      occurrences: occurrencesFor(['2026-01', '2026-02'], 31.5, 'LA FICTIVE'),
    });
    const classification = makeClassification({
      creditor: 'la caisse fictive',
      merchant: 'zoland',
      installmentCount: 3,
    });

    const result = await svc.validate(cluster, classification, '2026-02-10');

    expect(result).toEqual({ created: true, createdCount: 1 });
  });

  it('jeton ≥ 4 lettres présent seulement comme sous-chaîne (« cofi » dans « Cofinor ») -> pas de blocage', async () => {
    loansService.getAll.mockResolvedValue([loan('Cofinor Fictif', 88.4)]);
    const { cluster, classification } = revolving('cofi', 'cofi services');

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: true });
  });

  it("mot générique (« permanent ») ignoré même s'il figure en mot entier dans un créancier connu", async () => {
    loansService.getAll.mockResolvedValue([
      loan('Permanent Fictif Finance', 88.4),
    ]);
    const { cluster, classification } = revolving('permanent', 'zorbank');

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: true });
  });

  it('vrai doublon : jeton ≥ 4 lettres en mot entier (« zorbank » dans « ZORBANK CREDIT »), LLM divergent -> existing_loan_payment', async () => {
    loansService.getAll.mockResolvedValue([loan('ZORBANK CREDIT', 88.4)]);
    const { cluster, classification } = revolving('zorbank', 'zb finance');

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: false, reason: 'existing_loan_payment' });
  });

  it('vrai doublon : jeton court égal au créancier exact (« xo » = « XO ») -> existing_loan_payment', async () => {
    loansService.getAll.mockResolvedValue([loan('XO', 88.4)]);
    const { cluster, classification } = revolving('xo', 'maxifin');

    const result = await svc.validate(cluster, classification, '2026-03-10');

    expect(result).toEqual({ created: false, reason: 'existing_loan_payment' });
  });

  const subscription = (clusterCreditor: string, llmCreditor: string) => ({
    cluster: makeCluster({
      key: clusterCreditor,
      creditor: clusterCreditor,
      merchant: null,
      occurrences: occurrencesFor(['2026-01', '2026-02'], 19.9, 'PRLV FICTIF'),
    }),
    classification: makeClassification({
      classification: 'subscription',
      creditor: llmCreditor,
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    }),
  });

  it('abonnement : jeton « ca » contenu dans un abonnement suivi « Abonnement Canalix » -> suggestion créée', async () => {
    subscriptionsService.getAll.mockResolvedValue([
      {
        id: 'sub-x',
        name: 'Abonnement Canalix',
        monthlyAmount: 19.9,
        isActive: true,
      } as unknown as SubscriptionRow,
    ]);
    const { cluster, classification } = subscription('ca', 'ca fictif telecom');

    const result = await svc.validate(cluster, classification, '2026-02-10');

    expect(result.created).toBe(true);
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('abonnement : jeton « la » contenu dans une suggestion refusée « Cloudlab » -> suggestion créée', async () => {
    loanSuggestionsService.getAll.mockResolvedValue([
      {
        id: 'sug-x',
        label: 'cloudlab',
        monthlyAmount: 19.9,
        occurrencesSeen: 2,
        firstSeenStatementId: '2025-11',
        firstSeenDate: '2025-11-10',
        lastSeenDate: '2025-12-10',
        suggestedType: 'subscription',
        matchPattern: 'cloudlab',
        creditor: 'Cloudlab',
        status: 'rejected',
        createdAt: '2025-12-11T00:00:00.000Z',
      },
    ]);
    const { cluster, classification } = subscription('la', 'la boite fictive');

    const result = await svc.validate(cluster, classification, '2026-02-10');

    expect(result.created).toBe(true);
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('abonnement : vrai doublon par jeton en mot entier (« streamix » dans « Streamix SAS ») -> existing_subscription', async () => {
    subscriptionsService.getAll.mockResolvedValue([
      {
        id: 'sub-s',
        name: 'Vidéo',
        creditor: 'Streamix SAS',
        monthlyAmount: 19.9,
        isActive: true,
      } as unknown as SubscriptionRow,
    ]);
    const { cluster, classification } = subscription('streamix', 'sx media');

    const result = await svc.validate(cluster, classification, '2026-02-10');

    expect(result).toEqual({
      created: false,
      reason: 'existing_subscription',
    });
  });
});

describe('DetectionValidatorService — subscription découpée en sous-séries par montant (relecture du lot)', () => {
  // Cluster d'opérateur fictif mêlant 3 abonnements prélevés entre le 6 et
  // le 12 de chaque mois : sur le cluster entier les écarts alternent
  // 1-2 j / ~27 j ; par sous-série de montant ils sont mensuels.
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    svc = new DetectionValidatorService(
      {
        findExistingLoan: jest.fn().mockResolvedValue(null),
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      {
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as SubscriptionsService,
    );
  });

  const classification = () =>
    makeClassification({
      classification: 'subscription',
      creditor: 'telefictif',
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

  it('opérateur à 3 abonnements (24 € / 52,98 € / 92,97 €) -> 3 sous-séries valides, une suggestion chacune, labels désambiguïsés', async () => {
    const rows: [string, number][] = [];
    for (const m of ['2026-01', '2026-02', '2026-03']) {
      rows.push([`${m}-06`, 24], [`${m}-07`, 52.98], [`${m}-12`, 92.97]);
    }
    const cluster = makeCluster({
      key: 'telefictif',
      creditor: 'telefictif',
      merchant: null,
      occurrences: rows.map(([date, amount], i) => ({
        date,
        amount: -amount,
        description: 'PRLV TELEFICTIF',
        transactionId: `op-${i}`,
        statementId: date.slice(0, 7),
      })),
    });

    const result = await svc.validate(cluster, classification(), '2026-03-12');

    expect(result).toEqual({ created: true, createdCount: 3 });
    const incoming = loanSuggestionsService.upsertMany.mock.calls.map(
      ([, inc]) => inc[0],
    );
    expect(incoming.map((i) => i.suggestedType)).toEqual([
      'subscription',
      'subscription',
      'subscription',
    ]);
    expect(incoming.map((i) => i.label).sort()).toEqual([
      'telefictif (24€)',
      'telefictif (52.98€)',
      'telefictif (92.97€)',
    ]);
    expect(incoming.map((i) => i.occurrencesSeen)).toEqual([3, 3, 3]);
  });

  it('une sous-série valide + une sous-série dans un seul mois -> seule la valide crée sa suggestion', async () => {
    const cluster = makeCluster({
      key: 'telefictif',
      creditor: 'telefictif',
      merchant: null,
      occurrences: [
        ['2026-01-06', 24],
        ['2026-02-06', 24],
        ['2026-02-09', 70],
        ['2026-02-11', 70],
      ].map(([date, amount], i) => ({
        date: date as string,
        amount: -(amount as number),
        description: 'PRLV TELEFICTIF',
        transactionId: `op-${i}`,
        statementId: (date as string).slice(0, 7),
      })),
    });

    const result = await svc.validate(cluster, classification(), '2026-02-11');

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].monthlyAmount).toBe(24);
  });

  it('13 débits le même jour (même montant) -> rejetée subscription_insufficient_recurrence', async () => {
    const cluster = makeCluster({
      key: 'telefictif',
      creditor: 'telefictif',
      merchant: null,
      occurrences: Array.from({ length: 13 }, (_, i) => ({
        date: '2026-02-14',
        amount: -15,
        description: 'PRLV TELEFICTIF',
        transactionId: `d-${i}`,
        statementId: '2026-02',
      })),
    });

    const result = await svc.validate(cluster, classification(), '2026-02-14');

    expect(result).toEqual({
      created: false,
      reason: 'subscription_insufficient_recurrence',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });
});

describe("DetectionValidatorService — subscription : fraîcheur par sous-série, ordre d'émission, repli montant variable (2e relecture du lot)", () => {
  // Données synthétiques uniquement (créanciers fictifs).
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany' | 'getAll'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
    };
    svc = new DetectionValidatorService(
      {
        findExistingLoan: jest.fn().mockResolvedValue(null),
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
      {
        getAll: jest.fn().mockResolvedValue([]),
      } as unknown as SubscriptionsService,
    );
  });

  const classification = (creditor: string) =>
    makeClassification({
      classification: 'subscription',
      creditor,
      merchant: null,
      installmentCount: null,
      confidence: 0.85,
    });

  const clusterOf = (creditor: string, rows: [string, number][]) =>
    makeCluster({
      key: creditor,
      creditor,
      merchant: null,
      occurrences: [...rows]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, amount], i) => ({
          date,
          amount: -amount,
          description: `PRLV ${creditor.toUpperCase()}`,
          transactionId: `${creditor}-${i}`,
          statementId: date.slice(0, 7),
        })),
    });

  it('changement de prix : ancienne sous-série morte (> 60 j) + nouvelle vivante -> seule la vivante est suggérée', async () => {
    const cluster = clusterOf('vidozen', [
      ['2026-01-05', 9.99],
      ['2026-02-05', 9.99],
      ['2026-03-05', 9.99],
      ['2026-06-05', 12.99],
      ['2026-07-05', 12.99],
      ['2026-08-05', 12.99],
    ]);

    const result = await svc.validate(
      cluster,
      classification('vidozen'),
      '2026-08-05',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].monthlyAmount).toBe(12.99);
    expect(incoming[0].label).toBe('vidozen');
  });

  it('toutes les sous-séries mortes -> rejetée series_ended', async () => {
    const cluster = clusterOf('vidozen', [
      ['2026-01-05', 9.99],
      ['2026-02-05', 9.99],
      ['2026-03-05', 12.99],
      ['2026-04-05', 12.99],
      ['2026-06-20', 3],
    ]);

    const result = await svc.validate(
      cluster,
      classification('vidozen'),
      '2026-06-20',
    );

    expect(result).toEqual({ created: false, reason: 'series_ended' });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('plusieurs sous-séries vivantes -> émises par dernière occurrence croissante (la plus récente en dernier), pas par montant', async () => {
    // 10 € prélevé le 20 (dernière occurrence la plus récente), 30 € le 5.
    const cluster = clusterOf('opfictif', [
      ['2026-01-05', 30],
      ['2026-02-05', 30],
      ['2026-03-05', 30],
      ['2026-01-20', 10],
      ['2026-02-20', 10],
      ['2026-03-20', 10],
    ]);

    const result = await svc.validate(
      cluster,
      classification('opfictif'),
      '2026-03-20',
    );

    expect(result).toEqual({ created: true, createdCount: 2 });
    const amounts = loanSuggestionsService.upsertMany.mock.calls.map(
      ([, inc]) => inc[0].monthlyAmount,
    );
    expect(amounts).toEqual([30, 10]);
  });

  it("montant variable (> 5 % d'un mois à l'autre, aucune sous-série ≥ 2) -> repli sur le cluster entier : 1 suggestion au montant médian, libellé sans suffixe", async () => {
    const cluster = clusterOf('energix', [
      ['2026-01-12', 41.2],
      ['2026-02-11', 58.9],
      ['2026-03-12', 47.5],
    ]);

    const result = await svc.validate(
      cluster,
      classification('energix'),
      '2026-03-12',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [statementId, incoming] =
      loanSuggestionsService.upsertMany.mock.calls[0];
    expect(statementId).toBe('2026-03');
    expect(incoming[0].monthlyAmount).toBe(47.5);
    expect(incoming[0].label).toBe('energix');
    expect(incoming[0].occurrencesSeen).toBe(3);
  });

  it('montant variable mais espacement non mensuel -> repli rejeté subscription_interval_out_of_range', async () => {
    const cluster = clusterOf('energix', [
      ['2026-01-28', 41.2],
      ['2026-02-02', 58.9],
    ]);

    const result = await svc.validate(
      cluster,
      classification('energix'),
      '2026-02-02',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_interval_out_of_range',
    });
  });

  it("montant variable mais suggestion déjà refusée (médiane à ±5 %) -> repli bloqué par l'anti-re-suggestion", async () => {
    loanSuggestionsService.getAll.mockResolvedValue([
      {
        id: 'sug-e',
        label: 'energix',
        monthlyAmount: 48,
        occurrencesSeen: 3,
        firstSeenStatementId: '2025-10',
        firstSeenDate: '2025-10-12',
        lastSeenDate: '2025-12-12',
        suggestedType: 'subscription',
        matchPattern: 'energix',
        creditor: 'energix',
        status: 'rejected',
        createdAt: '2025-12-13T00:00:00.000Z',
      },
    ]);
    const cluster = clusterOf('energix', [
      ['2026-01-12', 41.2],
      ['2026-02-11', 58.9],
      ['2026-03-12', 47.5],
    ]);

    const result = await svc.validate(
      cluster,
      classification('energix'),
      '2026-03-12',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_already_dismissed',
    });
  });
  it('cluster mixte : sous-série morte (≥ 2 occ) + occurrences récentes mensuelles à montant variable -> repli sur les récentes seules, montant médian, sans suffixe', async () => {
    const cluster = clusterOf('energix', [
      ['2026-01-12', 9.99],
      ['2026-02-12', 9.99],
      ['2026-03-12', 9.99],
      ['2026-06-12', 31],
      ['2026-07-13', 44],
      ['2026-08-12', 37.5],
    ]);

    const result = await svc.validate(
      cluster,
      classification('energix'),
      '2026-08-12',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    expect(loanSuggestionsService.upsertMany).toHaveBeenCalledTimes(1);
    const [statementId, incoming] =
      loanSuggestionsService.upsertMany.mock.calls[0];
    expect(statementId).toBe('2026-08');
    expect(incoming[0].monthlyAmount).toBe(37.5);
    expect(incoming[0].label).toBe('energix');
    expect(incoming[0].occurrencesSeen).toBe(3);
  });

  it('montants variables mensuels contenant une paire à ±5 % non mensuelle -> 1 suggestion par le repli', async () => {
    // 41,20 et 42,00 forment une sous-série (±5 %) à 59 j d'écart : rejetée
    // pour espacement ; le cluster entier, lui, est mensuel.
    const cluster = clusterOf('energix', [
      ['2026-01-12', 41.2],
      ['2026-02-11', 58.9],
      ['2026-03-12', 42],
    ]);

    const result = await svc.validate(
      cluster,
      classification('energix'),
      '2026-03-12',
    );

    expect(result).toEqual({ created: true, createdCount: 1 });
    const [, incoming] = loanSuggestionsService.upsertMany.mock.calls[0];
    expect(incoming[0].monthlyAmount).toBe(42);
    expect(incoming[0].label).toBe('energix');
  });

  it('sous-séries valides toutes déjà refusées -> pas de repli (aucune re-suggestion à un montant médian mélangé)', async () => {
    const dismissed = (monthlyAmount: number) => ({
      id: `sug-${monthlyAmount}`,
      label: 'opfictif',
      monthlyAmount,
      occurrencesSeen: 3,
      firstSeenStatementId: '2025-10',
      firstSeenDate: '2025-10-05',
      lastSeenDate: '2025-12-05',
      suggestedType: 'subscription' as const,
      matchPattern: 'opfictif',
      creditor: 'opfictif',
      status: 'rejected' as const,
      createdAt: '2025-12-06T00:00:00.000Z',
    });
    loanSuggestionsService.getAll.mockResolvedValue([
      dismissed(10),
      dismissed(30),
    ]);
    const cluster = clusterOf('opfictif', [
      ['2026-01-05', 30],
      ['2026-02-05', 30],
      ['2026-03-05', 30],
      ['2026-01-20', 10],
      ['2026-02-20', 10],
      ['2026-03-20', 10],
    ]);

    const result = await svc.validate(
      cluster,
      classification('opfictif'),
      '2026-03-20',
    );

    expect(result).toEqual({
      created: false,
      reason: 'subscription_already_dismissed',
    });
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });
});
