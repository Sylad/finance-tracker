import type { ConfigService } from '@nestjs/config';
import { CreditStatementParseError, CreditStatementService } from './credit-statement.service';
import { expectAutoStrictCall } from './forced-tool-spec';

const INPUT = {
  documentType: 'credit_statement',
  creditor: 'COFIDIS',
  creditType: 'classic',
  currentBalance: 1000,
  maxAmount: null,
  monthlyPayment: 50,
  endDate: null,
  taeg: null,
  statementDate: '2026-04-30',
  startDate: null,
  accountNumber: null,
  rumNumber: null,
  installmentDetails: null,
};

const msg = (name?: string) => ({
  stop_reason: name ? 'tool_use' : 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: name
    ? [{ type: 'tool_use', id: 't', name, input: INPUT }]
    : [{ type: 'text', text: JSON.stringify(INPUT) }],
});

function setup(responses: unknown[]) {
  const service = new CreditStatementService({ get: () => 'sk-test' } as unknown as ConfigService);
  const stream = jest.fn();
  for (const r of responses) stream.mockReturnValueOnce({ finalMessage: () => Promise.resolve(r) });
  (service as unknown as { client: unknown }).client = { messages: { stream } };
  return { service, stream };
}

describe('CreditStatementService — tool_choice auto + outil strict (L76)', () => {
  it('requête conforme (auto, strict, consigne, pas de temperature)', async () => {
    const { service, stream } = setup([msg('extract_credit_statement')]);
    const res = await service.analyzeCreditStatement(Buffer.from('%PDF'));
    expect(res.creditor).toBe('COFIDIS');
    expect(stream).toHaveBeenCalledTimes(1);
    expectAutoStrictCall(stream.mock.calls[0][0], 'extract_credit_statement');
  });

  it('aucun tool_use → un nouvel essai puis CreditStatementParseError explicite', async () => {
    const { service, stream } = setup([msg(), msg()]);
    const err = await service.analyzeCreditStatement(Buffer.from('%PDF')).catch((e) => e);
    expect(err).toBeInstanceOf(CreditStatementParseError);
    expect(err.message).toMatch(/n'a pas appelé l'outil extract_credit_statement/);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('refus (stop_reason refusal) → un seul appel, CreditStatementParseError explicite', async () => {
    const refused = { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: null }, usage: { input_tokens: 1, output_tokens: 1 }, content: [] };
    const { service, stream } = setup([refused]);
    const err = await service.analyzeCreditStatement(Buffer.from('%PDF')).catch((e) => e);
    expect(err).toBeInstanceOf(CreditStatementParseError);
    expect(err.message).toMatch(/refus.*catégorie bio/);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('texte libre au 1er essai, tool_use au 2e → résultat', async () => {
    const { service, stream } = setup([msg(), msg('extract_credit_statement')]);
    await expect(service.analyzeCreditStatement(Buffer.from('%PDF'))).resolves.toMatchObject({ creditor: 'COFIDIS' });
    expect(stream).toHaveBeenCalledTimes(2);
  });
});
