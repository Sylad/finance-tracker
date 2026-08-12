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
    Pick<LoanSuggestionsService, 'upsertMany'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = {
      findExistingLoan: jest.fn().mockResolvedValue(null),
      getAll: jest.fn().mockResolvedValue([]),
    };
    loanSuggestionsService = {
      upsertMany: jest.fn().mockResolvedValue(undefined),
    };
    svc = new DetectionValidatorService(
      loansService as unknown as LoansService,
      loanSuggestionsService as unknown as LoanSuggestionsService,
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

    expect(result).toEqual({ created: true });
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

  it("(n) hasFuzzyKnownLoanPayment matche aussi un loan clôturé (isActive:false) -> rejetée existing_loan_payment", async () => {
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

    expect(result).toEqual({ created: true });
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
