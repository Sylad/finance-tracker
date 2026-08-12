import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { HealthAdviceService } from './health-advice.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { HealthService } from './health.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';
import { HealthDiagnostic } from '../../models/health.model';
import { Loan } from '../../models/loan.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const DIAGNOSTIC_STUB: HealthDiagnostic = {
  verdict: 'orange',
  causes: ['orange car reste à vivre 5.0 % du revenu < 10 %'],
  blocks: {
    resteAVivre: { status: 'orange', thresholdHit: 'orange car reste à vivre 5.0 % du revenu < 10 %', details: {} },
    chargeDette: { status: 'green', thresholdHit: null, details: {} },
    fluxTirages: { status: 'green', thresholdHit: null, details: {} },
    trajectoire: { status: 'green', thresholdHit: null, details: {} },
  },
  income: { monthly: 2500, source: 'detected', label: 'EMPLOYEUR' },
  reliability: 'ok',
  computedAt: '2026-08-12T10:00:00Z',
};

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'l1',
    name: 'Sofinco Réserve',
    type: 'revolving',
    category: 'consumer',
    monthlyPayment: 150,
    matchPattern: 'SOFINCO',
    isActive: true,
    maxAmount: 5000,
    usedAmount: 3000,
    taeg: 18.5,
    occurrencesDetected: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStatement(overrides: Partial<MonthlyStatement> = {}): MonthlyStatement {
  return {
    id: '2026-07',
    month: 7,
    year: 2026,
    uploadedAt: '2026-08-01T00:00:00Z',
    bankName: 'LBP',
    accountHolder: 'Sylvain',
    currency: 'EUR',
    openingBalance: 0,
    closingBalance: 0,
    totalCredits: 0,
    totalDebits: 0,
    transactions: [],
    healthScore: {
      score: 80,
      breakdown: {},
    } as unknown as MonthlyStatement['healthScore'],
    recurringCredits: [],
    analysisNarrative: '',
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    ollamaAdviceBaseUrl: 'http://ollama.local:11434',
    ollamaAdviceModel: 'qwen-test',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('HealthAdviceService', () => {
  let tmpDir: string;
  let svc: HealthAdviceService;
  let healthService: { getDiagnostic: jest.Mock };
  let loansService: { getAll: jest.Mock };
  let storageService: { getAllStatements: jest.Mock };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-health-advice-'));
    const dataDir = { getDataDir: () => tmpDir } as unknown as RequestDataDirService;
    healthService = { getDiagnostic: jest.fn().mockResolvedValue(DIAGNOSTIC_STUB) };
    loansService = { getAll: jest.fn().mockResolvedValue([makeLoan()]) };
    storageService = { getAllStatements: jest.fn().mockResolvedValue([makeStatement()]) };
    svc = new HealthAdviceService(
      makeConfig(),
      dataDir,
      healthService as unknown as HealthService,
      loansService as unknown as LoansService,
      storageService as unknown as StorageService,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generate : réponse Ollama valide -> advices triés par priority + cache écrit', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          advices: [
            { priority: 2, title: 'B', explanation: 'exp B', estimatedImpact: 'impact B' },
            { priority: 1, title: 'A', explanation: 'exp A', estimatedImpact: 'impact A' },
          ],
        }),
      }),
    } as any);

    const result = await svc.generate();

    expect(result.advices.map((a) => a.priority)).toEqual([1, 2]);
    expect(result.advices[0].title).toBe('A');
    expect(result.model).toBe('qwen-test');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.local:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.model).toBe('qwen-test');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');

    const cached = await svc.getCached();
    expect(cached).toEqual(result);

    fetchMock.mockRestore();
  });

  it('generate : HTTP 500 -> throw contenant "Ollama"', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 500 } as any);
    await expect(svc.generate()).rejects.toThrow(/Ollama/);
    fetchMock.mockRestore();
  });

  it('generate : JSON invalide dans response -> throw contenant "invalide"', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'not-json{{{' }),
    } as any);
    await expect(svc.generate()).rejects.toThrow(/invalide/);
    fetchMock.mockRestore();
  });

  it('generate : champs requis manquants -> throw "Réponse Ollama invalide"', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          advices: [{ priority: 1, title: '', explanation: 'x', estimatedImpact: 'y' }],
        }),
      }),
    } as any);
    await expect(svc.generate()).rejects.toThrow('Réponse Ollama invalide');
    fetchMock.mockRestore();
  });

  it('generate : fetch reject (ECONNREFUSED) -> throw', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as any)
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    await expect(svc.generate()).rejects.toThrow();
    fetchMock.mockRestore();
  });

  it('getCached : sans fichier -> null', async () => {
    expect(await svc.getCached()).toBeNull();
  });

  it('getCached : avec fichier -> contenu', async () => {
    const advice = {
      generatedAt: '2026-08-12T10:00:00Z',
      model: 'qwen-test',
      advices: [{ priority: 1, title: 'T', explanation: 'E', estimatedImpact: 'I' }],
    };
    fs.writeFileSync(path.join(tmpDir, 'health-advice-cache.json'), JSON.stringify(advice));
    expect(await svc.getCached()).toEqual(advice);
  });

  it('contexte prompt : agrégats uniquement, aucun libellé de transaction (sentinelle)', async () => {
    let capturedPrompt = '';
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation((async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      capturedPrompt = body.prompt;
      return {
        ok: true,
        json: async () => ({ response: JSON.stringify({ advices: [] }) }),
      };
    }) as any);

    storageService.getAllStatements.mockResolvedValue([
      makeStatement({
        transactions: [
          {
            id: 't1',
            date: '2026-07-05',
            description: 'SENTINELLE-PRIVEE',
            normalizedDescription: 'sentinelle-privee',
            amount: -42,
            currency: 'EUR',
            category: 'food',
            subcategory: '',
            isRecurring: false,
            confidence: 1,
          },
        ],
      }),
    ]);

    const result = await svc.generate();

    expect(capturedPrompt).not.toContain('SENTINELLE-PRIVEE');
    expect(capturedPrompt).toContain('food');
    expect(result.advices).toEqual([]);

    fetchMock.mockRestore();
  });
});
