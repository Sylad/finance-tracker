import { CreditDetectionService } from './credit-detection.service';
import type { MonthlyStatement } from '../../models/monthly-statement.model';

describe('CreditDetectionService.scanInBackground — hook de détection post-import (L4, L14)', () => {
  const statement = { id: '2026-02' } as MonthlyStatement;

  function build(scan: () => Promise<unknown>) {
    const importLogs = { log: jest.fn().mockResolvedValue({}) };
    const Ctor = CreditDetectionService as unknown as new (
      ...args: unknown[]
    ) => CreditDetectionService;
    const svc = new Ctor(
      ...Array.from({ length: 6 }, () => ({})),
      importLogs,
    );
    jest.spyOn(svc, 'scanStatement').mockImplementation(scan as never);
    return { svc, importLogs };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('note « sautée » quand le scan est sauté', async () => {
    const { svc, importLogs } = build(async () => ({
      clustersAnalyzed: 0,
      suggestionsCreated: 0,
      errors: [],
      skipped: true,
    }));
    svc.scanInBackground(statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Détection IA — 2026-02',
        status: 'success',
        note: expect.stringContaining('sautée'),
      }),
    );
  });

  it('note avec le nombre de suggestions quand le scan a tourné', async () => {
    const { svc, importLogs } = build(async () => ({
      clustersAnalyzed: 3,
      suggestionsCreated: 2,
      errors: [],
    }));
    svc.scanInBackground(statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        note: 'détection IA : 2 suggestions, 0 erreurs',
      }),
    );
  });

  it('journalise le résultat du scan de rattrapage une fois terminé', async () => {
    const { svc, importLogs } = build(async () => ({
      clustersAnalyzed: 0,
      suggestionsCreated: 0,
      errors: [],
      skipped: true,
      catchUp: Promise.resolve({
        clustersAnalyzed: 4,
        suggestionsCreated: 3,
        errors: [],
      }),
    }));
    svc.scanInBackground(statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        note: 'détection IA (rattrapage) : 3 suggestions, 0 erreurs',
      }),
    );
  });

  it("journalise en erreur l'échec du scan de rattrapage", async () => {
    const { svc, importLogs } = build(async () => ({
      clustersAnalyzed: 0,
      suggestionsCreated: 0,
      errors: [],
      skipped: true,
      catchUp: Promise.reject(new Error('ollama down')),
    }));
    svc.scanInBackground(statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        error: expect.stringContaining('ollama down'),
      }),
    );
  });

  it("n'échoue jamais, même si la journalisation elle-même échoue", async () => {
    const { svc, importLogs } = build(async () => {
      throw new Error('boom');
    });
    importLogs.log.mockRejectedValue(new Error('disque plein'));
    expect(() => svc.scanInBackground(statement)).not.toThrow();
    await flush();
    expect(importLogs.log).toHaveBeenCalled();
  });
});
