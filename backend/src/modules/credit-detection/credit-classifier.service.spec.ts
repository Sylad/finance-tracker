import { ConfigService } from '@nestjs/config';
import { CreditClassifierService } from './credit-classifier.service';
import { CandidateCluster } from '../../models/credit-detection.model';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    ollamaAdviceBaseUrl: 'http://ollama.local:11434',
    ollamaDetectionModel: 'qwen-detect-test',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const CLUSTER: CandidateCluster = {
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
      date: '2026-02-10',
      amount: -41.99,
      description: 'Klarni*Zoland 4X 2/3',
      transactionId: 'b',
      statementId: '2026-02',
    },
    {
      date: '2026-03-10',
      amount: -51.97,
      description: 'Klarni*Zoland 4X 3/3',
      transactionId: 'c',
      statementId: '2026-03',
    },
  ],
};

function validResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    response: JSON.stringify({
      classification: 'installment',
      creditor: 'klarni',
      merchant: 'zoland',
      installmentCount: 4,
      confidence: 0.9,
      rationale: 'Trois débits quasi identiques, créancier BNPL Klarna',
      ...overrides,
    }),
  };
}

describe('CreditClassifierService', () => {
  let svc: CreditClassifierService;

  beforeEach(() => {
    svc = new CreditClassifierService(makeConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('réponse Ollama valide -> objet retourné + prompt capturé contient les libellés et "installment"', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody(),
    } as never);

    const result = await svc.classify(CLUSTER);

    expect(result).toEqual({
      classification: 'installment',
      creditor: 'klarni',
      merchant: 'zoland',
      installmentCount: 4,
      confidence: 0.9,
      rationale: 'Trois débits quasi identiques, créancier BNPL Klarna',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.local:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.model).toBe('qwen-detect-test');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.prompt).toContain('Klarni*Zoland');
    expect(body.prompt).toContain('installment');
  });

  it('HTTP 500 -> throw', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: false,
      status: 500,
    } as never);

    await expect(svc.classify(CLUSTER)).rejects.toThrow();
  });

  it('JSON invalide dans response -> throw "invalide"', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'pas du json' }),
    } as never);

    await expect(svc.classify(CLUSTER)).rejects.toThrow(/invalide/i);
  });

  it('classification hors enum (loan) -> throw', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody({ classification: 'loan' }),
    } as never);

    await expect(svc.classify(CLUSTER)).rejects.toThrow();
  });

  it('confidence 1.4 -> throw', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody({ confidence: 1.4 }),
    } as never);

    await expect(svc.classify(CLUSTER)).rejects.toThrow();
  });

  it('fetch reject -> throw', async () => {
    jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(svc.classify(CLUSTER)).rejects.toThrow();
  });
});
