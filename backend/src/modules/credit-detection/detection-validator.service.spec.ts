import { DetectionValidatorService } from './detection-validator.service';
import {
  CandidateCluster,
  ClusterClassification,
} from '../../models/credit-detection.model';
import { LoansService, MatchResult } from '../loans/loans.service';
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';

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
  let loansService: jest.Mocked<Pick<LoansService, 'findExistingLoan'>>;
  let loanSuggestionsService: jest.Mocked<
    Pick<LoanSuggestionsService, 'upsertMany'>
  >;
  let svc: DetectionValidatorService;

  beforeEach(() => {
    loansService = { findExistingLoan: jest.fn().mockResolvedValue(null) };
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

    const result = await svc.validate(cluster, classification);

    expect(result).toEqual({ created: true });
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

  it('(b) montants hors ±5% (44.98 / 44.50 / 90.00) -> pas de suggestion créée', async () => {
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
        {
          date: '2026-03-07',
          amount: -90.0,
          description: 'Klarni*Zoland 3/3',
          transactionId: 'c',
          statementId: '2026-03',
        },
      ],
    });
    const classification = makeClassification();

    const result = await svc.validate(cluster, classification);

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

    const result = await svc.validate(cluster, classification);

    expect(result.created).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });

  it('(d) confidence 0.5 -> low_confidence, aucun appel', async () => {
    const cluster = makeCluster();
    const classification = makeClassification({ confidence: 0.5 });

    const result = await svc.validate(cluster, classification);

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

    const result = await svc.validate(cluster, classification);

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

    const result = await svc.validate(cluster, classification);

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

    const result = await svc.validate(cluster, classification);

    expect(result).toEqual({ created: false, reason: 'not_credit' });
    expect(loansService.findExistingLoan).not.toHaveBeenCalled();
    expect(loanSuggestionsService.upsertMany).not.toHaveBeenCalled();
  });
});
