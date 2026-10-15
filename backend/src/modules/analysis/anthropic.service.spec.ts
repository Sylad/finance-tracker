import type { ConfigService } from '@nestjs/config';
import { AnthropicParseError, AnthropicService } from './anthropic.service';
import { expectAutoStrictCall } from './forced-tool-spec';

// Chemins volontairement hors `required` (strict autorise les propriétés optionnelles ;
// ces trois-là restent optionnelles pour ne pas gonfler la sortie de chaque transaction).
const OPTIONAL = [
  '$.transactions[].targetAccountNumber',
  '$.externalAccountBalances[].label',
  '$.externalAccountBalances[].asOfDate',
];

const P1_INPUT = {
  documentType: 'bank_statement',
  bankName: 'LBP',
  accountHolder: 'S',
  currency: 'EUR',
  openingBalance: 100,
  closingBalance: 90,
  transactions: [{ date: '2026-03-05', label: 'CARREFOUR', amount: -10, category: 'food', isRecurring: false }],
  externalAccountBalances: [],
};
const P2_INPUT = {
  recurringCredits: [],
  analysisNarrative: 'Bilan.',
  claudeHealthComment: 'RAS.',
  suggestedRecurringExpenses: [],
};

const toolMsg = (name: string, input: unknown) => ({
  stop_reason: 'tool_use',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'tool_use', id: 't', name, input }],
});
const textMsg = () => ({
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'text', text: JSON.stringify(P1_INPUT) }],
});

function setup(streamResponses: unknown[], createResponses: unknown[] = []) {
  const service = new AnthropicService({ get: () => 'sk-test' } as unknown as ConfigService);
  const stream = jest.fn();
  for (const r of streamResponses) stream.mockReturnValueOnce({ finalMessage: () => Promise.resolve(r) });
  const create = jest.fn();
  for (const r of createResponses) create.mockResolvedValueOnce(r);
  (service as unknown as { client: unknown }).client = { messages: { stream, create } };
  return { service, stream, create };
}

describe('AnthropicService — tool_choice auto + outil strict (L76)', () => {
  it('phase 1 (extract_transactions) : requête conforme', async () => {
    const { service, stream } = setup(
      [toolMsg('extract_transactions', P1_INPUT)],
      [toolMsg('analyze_finances', P2_INPUT)],
    );
    await service.analyzeBankStatement(Buffer.from('%PDF'));
    expect(stream).toHaveBeenCalledTimes(1);
    expectAutoStrictCall(stream.mock.calls[0][0], 'extract_transactions', OPTIONAL);
  });

  it('phase 2 (analyze_finances) : requête conforme', async () => {
    const { service, create } = setup(
      [toolMsg('extract_transactions', P1_INPUT)],
      [toolMsg('analyze_finances', P2_INPUT)],
    );
    await service.analyzeBankStatement(Buffer.from('%PDF'));
    expect(create).toHaveBeenCalledTimes(1);
    expectAutoStrictCall(create.mock.calls[0][0], 'analyze_finances');
  });

  it('budgets : phase 1 à 32k (relance 64k), phase 2 à 16000 (la réflexion compte dans max_tokens)', async () => {
    const { service, stream, create } = setup(
      [toolMsg('extract_transactions', P1_INPUT)],
      [toolMsg('analyze_finances', P2_INPUT)],
    );
    await service.analyzeBankStatement(Buffer.from('%PDF'));
    expect(stream.mock.calls[0][0].max_tokens).toBe(32768);
    expect(create.mock.calls[0][0].max_tokens).toBe(16000);
  });

  it('phase 2 tronquée (max_tokens) → erreur explicite, jamais une analyse partielle', async () => {
    const truncated = { stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 16000 }, content: [{ type: 'tool_use', id: 't', name: 'analyze_finances', input: {} }] };
    const { service, create } = setup([toolMsg('extract_transactions', P1_INPUT)], [truncated]);
    await expect(service.analyzeBankStatement(Buffer.from('%PDF'))).rejects.toThrow(/Phase 2 tronquée/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('phase 1 refusée → pas de relance, erreur explicite de refus', async () => {
    const refused = { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, usage: { input_tokens: 1, output_tokens: 1 }, content: [] };
    const { service, stream, create } = setup([refused]);
    await expect(service.analyzeBankStatement(Buffer.from('%PDF'))).rejects.toThrow(/Phase 1: .*refus.*catégorie cyber/);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('phase 1 sans tool_use du bon nom → un nouvel essai, puis erreur explicite', async () => {
    const { service, stream, create } = setup([textMsg(), textMsg()]);
    await expect(service.analyzeBankStatement(Buffer.from('%PDF'))).rejects.toThrow(
      /Phase 1: Claude n'a pas appelé l'outil extract_transactions/,
    );
    expect(stream).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it('phase 1 : un tool_use d’un AUTRE nom est refusé comme un texte libre', async () => {
    const { service, stream } = setup([toolMsg('autre_outil', P1_INPUT), toolMsg('autre_outil', P1_INPUT)]);
    await expect(service.analyzeBankStatement(Buffer.from('%PDF'))).rejects.toBeInstanceOf(AnthropicParseError);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('phase 1 : texte libre puis tool_use au 2e essai → analyse menée à terme', async () => {
    const { service, stream } = setup(
      [textMsg(), toolMsg('extract_transactions', P1_INPUT)],
      [toolMsg('analyze_finances', P2_INPUT)],
    );
    const res = await service.analyzeBankStatement(Buffer.from('%PDF'));
    expect(stream).toHaveBeenCalledTimes(2);
    expect(res.transactions).toHaveLength(1);
  });

  it('phase 2 sans tool_use → un nouvel essai, puis AnthropicParseError explicite', async () => {
    const { service, create } = setup([toolMsg('extract_transactions', P1_INPUT)], [textMsg(), textMsg()]);
    await expect(service.analyzeBankStatement(Buffer.from('%PDF'))).rejects.toThrow(
      /Phase 2: Claude n'a pas appelé l'outil analyze_finances/,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });
});
