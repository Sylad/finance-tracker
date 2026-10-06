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
  DetectionScanResult,
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
        // L44 : même mois que la 1re → série non mensuelle, donc routée au
        // LLM par le tri déterministe (ces tests portent sur la voie LLM).
        date: '2026-01-14',
        amount: -50,
        description: `${key} 2`,
        transactionId: `${key}-b`,
        statementId: '2026-02',
      },
    ],
  };
}

function makeRuleCluster(key: string, descriptions: string[], dates?: string[]): CandidateCluster {
  const ds = dates ?? descriptions.map((_, i) => `2026-0${i + 1}-10`);
  return {
    key,
    creditor: key,
    merchant: null,
    occurrences: descriptions.map((description, i) => ({
      date: ds[i],
      amount: -50,
      description,
      transactionId: `${key}-${i}`,
      statementId: ds[i].slice(0, 7),
    })),
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
          date: '2026-02-27',
          amount: -50,
          description: 'straddling 1',
          transactionId: 'straddling-a',
          statementId: '2026-02',
        },
        {
          date: '2026-03-02',
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

  describe('L4 : un seul scan à la fois', () => {
    const cluster = makeCluster('c1');

    it('un second scan lancé pendant le premier est sauté (aucun accès aux relevés, aucun appel LLM)', async () => {
      let release!: () => void;
      clustering.buildClusters.mockResolvedValue([cluster] as never);
      classifier.classify.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve({} as never);
        }) as never,
      );
      validator.validate.mockResolvedValue({ created: false } as never);

      const first = svc.scanAll();
      await new Promise((r) => setImmediate(r));
      storage.getAllStatements.mockClear();
      classifier.classify.mockClear();

      const second = await svc.scanAll();
      const third = await svc.scanStatement(stmt('2026-02'));

      expect(second).toEqual({
        clustersAnalyzed: 0,
        suggestionsCreated: 0,
        errors: [],
        skipped: true,
      });
      expect(third.skipped).toBe(true);
      expect(storage.getAllStatements).not.toHaveBeenCalled();
      expect(classifier.classify).not.toHaveBeenCalled();

      release();
      const done = await first;
      expect(done.skipped).toBeUndefined();
    });

    it('un relevé sauté pendant un scan relance UN scan complet à la fin (L4)', async () => {
      let release!: () => void;
      clustering.buildClusters.mockResolvedValue([] as never);
      clustering.buildClusters.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve([]);
        }) as never,
      );
      const first = svc.scanAll();
      await new Promise((r) => setImmediate(r));
      expect((await svc.scanStatement(stmt('2026-02'))).skipped).toBe(true);
      expect((await svc.scanStatement(stmt('2026-03'))).skipped).toBe(true);
      expect(clustering.buildClusters).toHaveBeenCalledTimes(1);

      release();
      await first;
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(clustering.buildClusters).toHaveBeenCalledTimes(2);
      await new Promise((r) => setImmediate(r));
      expect(clustering.buildClusters).toHaveBeenCalledTimes(2);
      clustering.buildClusters.mockResolvedValue([] as never);
      expect((await svc.scanAll()).skipped).toBeUndefined();
    });

    it('le relevé sauté reçoit le résultat du scan de rattrapage (catchUp), partagé entre relevés', async () => {
      let release!: () => void;
      clustering.buildClusters.mockResolvedValue([] as never);
      clustering.buildClusters.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve([]);
        }) as never,
      );
      const first = svc.scanAll();
      await new Promise((r) => setImmediate(r));
      const a = await svc.scanStatement(stmt('2026-02'));
      const b = await svc.scanStatement(stmt('2026-03'));
      expect(a.catchUp).toBeDefined();
      expect(b.catchUp).toBe(a.catchUp);

      release();
      await first;
      const result = await (a.catchUp as Promise<DetectionScanResult>);
      expect(result.skipped).toBeUndefined();
      expect(result.errors).toEqual([]);
    });

    it("l'échec du scan de rattrapage rejette catchUp (visible de l'import-log)", async () => {
      let release!: () => void;
      clustering.buildClusters.mockResolvedValue([] as never);
      clustering.buildClusters.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve([]);
        }) as never,
      );
      const first = svc.scanAll();
      await new Promise((r) => setImmediate(r));
      const a = await svc.scanStatement(stmt('2026-02'));
      clustering.buildClusters.mockRejectedValueOnce(new Error('ollama down') as never);

      release();
      await first;
      await expect(a.catchUp).rejects.toThrow('ollama down');
      clustering.buildClusters.mockResolvedValue([] as never);
      expect((await svc.scanAll()).skipped).toBeUndefined();
    });

    it('sans scan sauté, aucun scan de rattrapage', async () => {
      clustering.buildClusters.mockResolvedValue([] as never);
      await svc.scanAll();
      await new Promise((r) => setImmediate(r));
      expect(clustering.buildClusters).toHaveBeenCalledTimes(1);
    });

    it('le verrou est libéré après un scan réussi', async () => {
      clustering.buildClusters.mockResolvedValue([] as never);
      await svc.scanAll();
      const again = await svc.scanAll();
      expect(again.skipped).toBeUndefined();
    });

    it('le verrou est libéré quand le scan échoue (502 Ollama ou exception)', async () => {
      clustering.buildClusters.mockRejectedValueOnce(new Error("boom") as never);
      await expect(svc.scanAll()).rejects.toThrow('boom');
      clustering.buildClusters.mockResolvedValue([] as never);
      const again = await svc.scanAll();
      expect(again.skipped).toBeUndefined();
    });
  });

  describe('L44 : tri déterministe avant le LLM', () => {
    it('établissement listé -> pas de LLM, validate avec la classification de la règle', async () => {
      const cofidis = makeRuleCluster('cofidis', ['PRLV COFIDIS 1', 'PRLV COFIDIS 2', 'PRLV COFIDIS 3']);
      clustering.buildClusters.mockReturnValue([cofidis]);
      validator.validate.mockResolvedValue({ created: true });

      const result = await svc.scanAll();

      expect(classifier.classify).not.toHaveBeenCalled();
      expect(validator.validate).toHaveBeenCalledWith(
        cofidis,
        expect.objectContaining({ classification: 'classic', creditor: 'COFIDIS', confidence: 1 }),
        expect.any(String),
      );
      expect(result).toEqual({ clustersAnalyzed: 1, suggestionsCreated: 1, errors: [] });
    });

    it('autre société mensuelle -> subscription sans LLM', async () => {
      const streamio = makeRuleCluster('streamio', ['PRLV SEPA STREAMIO', 'PRLV SEPA STREAMIO']);
      clustering.buildClusters.mockReturnValue([streamio]);
      validator.validate.mockResolvedValue({ created: true });

      await svc.scanAll();

      expect(classifier.classify).not.toHaveBeenCalled();
      expect(validator.validate).toHaveBeenCalledWith(
        streamio,
        expect.objectContaining({ classification: 'subscription', creditor: 'STREAMIO' }),
        expect.any(String),
      );
    });

    it('payé exclu (impôts) -> ni LLM ni suggestion, compté analysé', async () => {
      clustering.buildClusters.mockReturnValue([
        makeRuleCluster('dgfip', ['PRLV DGFIP IMPOT', 'PRLV DGFIP IMPOT']),
      ]);

      const result = await svc.scanAll();

      expect(classifier.classify).not.toHaveBeenCalled();
      expect(validator.validate).not.toHaveBeenCalled();
      expect(result).toEqual({ clustersAnalyzed: 1, suggestionsCreated: 0, errors: [] });
    });

    it('ambigu (mot de crédit, non listé) -> LLM', async () => {
      const pret = makeRuleCluster('pret', ['PRLV BANQUE EXEMPLE ECHEANCE PRET', 'PRLV BANQUE EXEMPLE ECHEANCE PRET']);
      clustering.buildClusters.mockReturnValue([pret]);
      classifier.classify.mockResolvedValue(makeClassification({ classification: 'classic' }));
      validator.validate.mockResolvedValue({ created: false, reason: 'loan_insufficient_recurrence' });

      await svc.scanAll();

      expect(classifier.classify).toHaveBeenCalledWith(pret);
    });

    it('Ollama down mais des clusters triés par règle -> pas de 502, erreurs du LLM listées', async () => {
      clustering.buildClusters.mockReturnValue([
        makeRuleCluster('cofidis', ['PRLV COFIDIS 1', 'PRLV COFIDIS 2', 'PRLV COFIDIS 3']),
        makeCluster('a'),
      ]);
      classifier.classify.mockRejectedValue(new TypeError('fetch failed'));
      validator.validate.mockResolvedValue({ created: true });

      const result = await svc.scanAll();

      expect(result.suggestionsCreated).toBe(1);
      expect(result.errors).toEqual([{ clusterKey: 'a', message: 'fetch failed' }]);
    });
  });
});
