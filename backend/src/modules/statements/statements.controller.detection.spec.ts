import { StatementsController } from './statements.controller';

describe('StatementsController — note du hook de détection post-import (L4)', () => {
  const statement = { id: '2026-02' } as never;

  function build(scanResult: unknown) {
    const creditDetection = {
      scanStatement: jest.fn().mockResolvedValue(scanResult),
    };
    const importLogs = { log: jest.fn().mockResolvedValue({}) };
    const Ctor = StatementsController as unknown as new (
      ...args: unknown[]
    ) => Record<string, unknown>;
    const ctrl = new Ctor(...Array.from({ length: 12 }, () => ({})));
    ctrl['creditDetection'] = creditDetection;
    ctrl['importLogs'] = importLogs;
    return { ctrl, importLogs };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('note « sautée » quand le scan est sauté', async () => {
    const { ctrl, importLogs } = build({
      clustersAnalyzed: 0,
      suggestionsCreated: 0,
      errors: [],
      skipped: true,
    });
    (ctrl['triggerDetection'] as (s: unknown) => void).call(ctrl, statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        note: expect.stringContaining('sautée'),
      }),
    );
  });

  it('note avec le nombre de suggestions quand le scan a tourné', async () => {
    const { ctrl, importLogs } = build({
      clustersAnalyzed: 3,
      suggestionsCreated: 2,
      errors: [],
    });
    (ctrl['triggerDetection'] as (s: unknown) => void).call(ctrl, statement);
    await flush();
    expect(importLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        note: 'détection IA : 2 suggestions, 0 erreurs',
      }),
    );
  });
});
