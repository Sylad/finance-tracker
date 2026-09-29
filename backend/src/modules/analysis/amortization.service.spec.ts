import type { ConfigService } from '@nestjs/config';
import { AmortizationParseError, AmortizationService } from './amortization.service';

const TOOL_INPUT = {
  creditor: 'CETELEM',
  initialPrincipal: 1000,
  monthlyPayment: 510,
  startDate: '2026-01-15',
  endDate: '2026-02-15',
  taeg: null,
  accountNumber: null,
  schedule: [
    { date: '2026-02-15', capitalRemaining: 0, capitalPaid: 500, interestPaid: 5 },
    { date: '2026-01-15', capitalRemaining: 500, capitalPaid: 500, interestPaid: 10 },
  ],
};

function message(stop_reason: string, output_tokens: number) {
  return {
    stop_reason,
    usage: { input_tokens: 1000, output_tokens },
    content:
      stop_reason === 'max_tokens'
        ? []
        : [{ type: 'tool_use', id: 't', name: 'extract_amortization_schedule', input: TOOL_INPUT }],
  };
}

function setup(responses: ReturnType<typeof message>[]) {
  const config = { get: () => 'sk-test' } as unknown as ConfigService;
  const service = new AmortizationService(config);
  const stream = jest.fn();
  for (const r of responses) stream.mockReturnValueOnce({ finalMessage: () => Promise.resolve(r) });
  (service as unknown as { client: unknown }).client = { messages: { stream } };
  return { service, stream };
}

describe('AmortizationService — retry à 64k (L11)', () => {
  it('réponse complète → un seul appel à 16k', async () => {
    const { service, stream } = setup([message('tool_use', 800)]);
    const out = await service.analyzeAmortization(Buffer.from('%PDF'));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].max_tokens).toBe(16384);
    expect(out.schedule.map((l) => l.date)).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('tronquée à 16k → relance à 64k, résultat extrait', async () => {
    const { service, stream } = setup([message('max_tokens', 16384), message('tool_use', 20000)]);
    const out = await service.analyzeAmortization(Buffer.from('%PDF'));
    expect(stream.mock.calls.map((c) => c[0].max_tokens)).toEqual([16384, 64000]);
    expect(out.creditor).toBe('CETELEM');
  });

  it('encore tronquée à 64k → AmortizationParseError, pas de 3e essai', async () => {
    const { service, stream } = setup([message('max_tokens', 16384), message('max_tokens', 64000)]);
    await expect(service.analyzeAmortization(Buffer.from('%PDF'))).rejects.toBeInstanceOf(AmortizationParseError);
    expect(stream).toHaveBeenCalledTimes(2);
  });
});
