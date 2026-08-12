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

  it('prompt v2 : consignes anti-bruit (loan réservé aux organismes de crédit, exemples génériques énergie/impôts/transport/streaming -> subscription ou not_credit) et découpage aval des plans N× entremêlés', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody(),
    } as never);

    await svc.classify(CLUSTER);

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    const prompt: string = body.prompt;
    // loan réservé aux organismes de crédit / banques de financement
    expect(prompt).toMatch(/organismes? de crédit/i);
    // exemples génériques publics couvrant les catégories qui polluaient le scan réel
    expect(prompt).toMatch(/EDF|Engie/);
    expect(prompt).toMatch(/DGFIP|trésor public/i);
    expect(prompt).toMatch(/SNCF|Navigo/);
    expect(prompt).toMatch(/Canal\+|Netflix/);
    // round 7 fix 2 : assurances (IARD, prévoyance, mutuelle...) routées
    // subscription et non loan — "LBP Assurances IARD Accidents de la vie"
    // classé loan à tort dans le scan réel
    expect(prompt).toMatch(/IARD|assurance/i);
    // le découpage par montant des plans N× entremêlés est fait en aval (validateur)
    expect(prompt).toMatch(/découpage.*aval|aval.*découpage/i);
    // round 3 fix 3(a) : qwen3 répond parfois "loan" hors enum -> consigne explicite
    expect(prompt).toMatch(/jamais.*"loan"|"loan".*jamais/i);
    // round 8 fix 1 : installmentCount du LLM peu fiable (cas réel "8×"
    // inventé pour un plan Klarna 3×) -> consigne explicite null si incertain
    expect(prompt).toMatch(/2×.*3×.*4×/);
    expect(prompt).toMatch(/ne devine jamais/i);
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

  it('classification hors enum générique (mortgage) -> throw', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody({ classification: 'mortgage' }),
    } as never);

    await expect(svc.classify(CLUSTER)).rejects.toThrow();
  });

  it('round 3 fix 3(b) : classification "loan" (alias hors enum de qwen3) -> mappée sur "classic", pas d\'erreur', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => validResponseBody({ classification: 'loan' }),
    } as never);

    const result = await svc.classify(CLUSTER);

    expect(result.classification).toBe('classic');
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
