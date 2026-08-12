import { BadGatewayException } from '@nestjs/common';
import { CreditDetectionService } from './credit-detection.service';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CreditClassifierService } from './credit-classifier.service';
import { DetectionValidatorService } from './detection-validator.service';
import { StorageService } from '../storage/storage.service';
import { LoansService } from '../loans/loans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  CandidateCluster,
  ClusterClassification,
} from '../../models/credit-detection.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';

function makeCluster(key: string): CandidateCluster {
  return {
    key,
    creditor: key,
    merchant: null,
    occurrences: [
      {
        date: '2026-01-10',
        amount: -50,
        description: `${key} 1`,
        transactionId: `${key}-a`,
        statementId: '2026-01',
      },
      {
        date: '2026-02-10',
        amount: -50,
        description: `${key} 2`,
        transactionId: `${key}-b`,
        statementId: '2026-02',
      },
    ],
  };
}

function makeClassification(
  overrides: Partial<ClusterClassification> = {},
): ClusterClassification {
  return {
    classification: 'subscription',
    creditor: 'klarni',
    merchant: null,
    installmentCount: null,
    confidence: 0.9,
    rationale: 'test',
    ...overrides,
  };
}

const stmt = (id: string): MonthlyStatement =>
  ({
    id,
    month: 1,
    year: 2026,
    uploadedAt: '',
    bankName: 'X',
    accountHolder: 'Demo',
    currency: 'EUR',
    openingBalance: 0,
    closingBalance: 0,
    totalCredits: 0,
    totalDebits: 0,
    transactions: [],
    healthScore: {
      total: 50,
      breakdown: {
        savingsRate: 50,
        expenseControl: 50,
        debtBurden: 50,
        cashFlowBalance: 50,
        irregularSpending: 50,
      },
      trend: 'insufficient_data',
      claudeComment: '',
    },
    recurringCredits: [],
    analysisNarrative: '',
    externalAccountBalances: [],
  }) as unknown as MonthlyStatement;

describe('CreditDetectionService', () => {
  let clustering: jest.Mocked<
    Pick<CandidateClusteringService, 'buildClusters'>
  >;
  let classifier: jest.Mocked<Pick<CreditClassifierService, 'classify'>>;
  let validator: jest.Mocked<Pick<DetectionValidatorService, 'validate'>>;
  let storage: jest.Mocked<Pick<StorageService, 'getAllStatements'>>;
  let loansService: jest.Mocked<Pick<LoansService, 'getAll'>>;
  let subscriptionsService: jest.Mocked<Pick<SubscriptionsService, 'getAll'>>;
  let svc: CreditDetectionService;

  beforeEach(() => {
    clustering = { buildClusters: jest.fn() };
    classifier = { classify: jest.fn() };
    validator = { validate: jest.fn() };
    storage = {
      getAllStatements: jest
        .fn()
        .mockResolvedValue([stmt('2026-01'), stmt('2026-02')]),
    };
    loansService = { getAll: jest.fn().mockResolvedValue([]) };
    subscriptionsService = { getAll: jest.fn().mockResolvedValue([]) };

    svc = new CreditDetectionService(
      clustering as unknown as CandidateClusteringService,
      classifier as unknown as CreditClassifierService,
      validator as unknown as DetectionValidatorService,
      storage as unknown as StorageService,
      loansService as unknown as LoansService,
      subscriptionsService as unknown as SubscriptionsService,
    );
  });

  it('a) scanAll : 2 clusters -> classify 2x, validate 2x, {2, N, []}', async () => {
    const clusters = [makeCluster('a'), makeCluster('b')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockResolvedValue(makeClassification());
    validator.validate.mockResolvedValue({ created: true });

    const result = await svc.scanAll();

    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(validator.validate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      clustersAnalyzed: 2,
      suggestionsCreated: 2,
      errors: [],
    });
  });

  it("b) scanAll : 1 cluster en erreur JSON -> errors[1], l'autre traité", async () => {
    const clusters = [makeCluster('a'), makeCluster('b')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockImplementation(
      async (cluster: CandidateCluster) => {
        if (cluster.key === 'a')
          throw new Error('Réponse Ollama invalide: JSON illisible');
        return makeClassification();
      },
    );
    validator.validate.mockResolvedValue({ created: true });

    const result = await svc.scanAll();

    expect(result.clustersAnalyzed).toBe(2);
    expect(result.errors).toEqual([
      { clusterKey: 'a', message: 'Réponse Ollama invalide: JSON illisible' },
    ]);
    expect(result.suggestionsCreated).toBe(1);
    expect(validator.validate).toHaveBeenCalledTimes(1);
  });

  it('f) scanAll : classify OK sur 2 clusters, validate throw sur le 1er -> le 2e traité, errors.length 1', async () => {
    const clusters = [makeCluster('a'), makeCluster('b')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockResolvedValue(makeClassification());
    validator.validate.mockImplementation(async (cluster: CandidateCluster) => {
      if (cluster.key === 'a') throw new Error('ENOENT: loans.json');
      return { created: true };
    });

    const result = await svc.scanAll();

    expect(result.clustersAnalyzed).toBe(2);
    expect(result.errors).toEqual([
      { clusterKey: 'a', message: 'validate échoué : ENOENT: loans.json' },
    ]);
    expect(result.suggestionsCreated).toBe(1);
    expect(validator.validate).toHaveBeenCalledTimes(2);
  });

  it('c) scanAll : tous en fetch-reject -> throw BadGatewayException', async () => {
    const clusters = [makeCluster('a'), makeCluster('b')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockRejectedValue(new TypeError('fetch failed'));

    await expect(svc.scanAll()).rejects.toThrow(BadGatewayException);
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('d) scanStatement : clusterise sur tous les relevés (comme scanAll) mais ne garde que les clusters touchant le relevé importé', async () => {
    // Round 4 fix I-3 : scanStatement ne clusterisait QUE le nouveau relevé
    // → un plan mensuel (1 occurrence/relevé) n'atteignait jamais
    // MIN_OCCURRENCES=2 du clustering, rendant le hook post-import
    // structurellement inutile pour tout créancier récurrent normal.
    // Fix : clusterise sur getAllStatements() (comme scanAll), puis filtre
    // pour ne garder que les clusters ayant au moins une occurrence dont
    // statementId === statement.id — seuls les clusters "touchés" par le
    // nouveau relevé partent au LLM (pas de re-scan inutile de l'historique
    // entier à chaque import).
    const single = stmt('2026-03');
    storage.getAllStatements.mockResolvedValue([
      stmt('2026-01'),
      stmt('2026-02'),
      single,
    ]);

    // Cluster à cheval sur l'ancien relevé (2026-02) et le nouveau (2026-03)
    // -> doit être analysé.
    const straddlingCluster: CandidateCluster = {
      key: 'straddling',
      creditor: 'straddling',
      merchant: null,
      occurrences: [
        {
          date: '2026-02-10',
          amount: -50,
          description: 'straddling 1',
          transactionId: 'straddling-a',
          statementId: '2026-02',
        },
        {
          date: '2026-03-10',
          amount: -50,
          description: 'straddling 2',
          transactionId: 'straddling-b',
          statementId: '2026-03',
        },
      ],
    };
    // Cluster purement ancien (2026-01/2026-02 uniquement) -> pas touché par
    // l'import de 2026-03, ne doit PAS être analysé.
    const oldOnlyCluster = makeCluster('old-only');

    clustering.buildClusters.mockReturnValue([
      straddlingCluster,
      oldOnlyCluster,
    ]);
    classifier.classify.mockResolvedValue(makeClassification());
    validator.validate.mockResolvedValue({ created: true });

    const result = await svc.scanStatement(single);

    expect(storage.getAllStatements).toHaveBeenCalled();
    expect(clustering.buildClusters).toHaveBeenCalledWith(
      [stmt('2026-01'), stmt('2026-02'), single],
      expect.any(Set),
    );
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(classifier.classify).toHaveBeenCalledWith(straddlingCluster);
    expect(result.clustersAnalyzed).toBe(1);
  });

  it('e) confidence basse -> suggestionsCreated 0 sans erreur', async () => {
    const clusters = [makeCluster('a')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockResolvedValue(
      makeClassification({ confidence: 0.2 }),
    );
    validator.validate.mockResolvedValue({
      created: false,
      reason: 'low_confidence',
    });

    const result = await svc.scanAll();

    expect(result).toEqual({
      clustersAnalyzed: 1,
      suggestionsCreated: 0,
      errors: [],
    });
  });

  it("g) createdCount agrégé : 1 cluster produit 3 sous-suggestions installment, l'autre 1 -> suggestionsCreated 4", async () => {
    const clusters = [makeCluster('a'), makeCluster('b')];
    clustering.buildClusters.mockReturnValue(clusters);
    classifier.classify.mockResolvedValue(makeClassification());
    validator.validate.mockImplementation(async (cluster: CandidateCluster) => {
      if (cluster.key === 'a') return { created: true, createdCount: 3 };
      return { created: true };
    });

    const result = await svc.scanAll();

    expect(result).toEqual({
      clustersAnalyzed: 2,
      suggestionsCreated: 4,
      errors: [],
    });
  });
});
