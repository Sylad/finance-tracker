import type Anthropic from '@anthropic-ai/sdk';
import {
  AUTO_TOOL_CHOICE,
  EXTRACTION_OUTPUT_CONFIG,
  findToolUse,
  onlyToolInstruction,
  requireToolUse,
  runWithToolRetry,
  ToolUseMissingError,
  ToolUseRefusedError,
} from './forced-tool.helper';
import { strictSchemaViolations } from './forced-tool-spec';

const withTool = (name = 'x'): Anthropic.Message =>
  ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name, input: { a: 1 } }] }) as unknown as Anthropic.Message;
const textOnly = (stop_reason = 'end_turn'): Anthropic.Message =>
  ({ stop_reason, content: [{ type: 'text', text: '{"a":1}' }] }) as unknown as Anthropic.Message;

const refusal = (category: string | null = 'cyber', withTool = false): Anthropic.Message =>
  ({
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category, explanation: null },
    content: withTool ? [{ type: 'tool_use', id: 't', name: 'x', input: { a: 1 } }] : [],
  }) as unknown as Anthropic.Message;

describe('forced-tool.helper (L76)', () => {
  it('EXTRACTION_OUTPUT_CONFIG : effort low explicite (réflexion adaptative bornée)', () => {
    expect(EXTRACTION_OUTPUT_CONFIG).toEqual({ effort: 'low' });
  });

  it('AUTO_TOOL_CHOICE et la consigne ont la forme voulue', () => {
    expect(AUTO_TOOL_CHOICE).toEqual({ type: 'auto' });
    expect(onlyToolInstruction('x')).toBe("Tu dois répondre en appelant l'outil x, et uniquement lui.");
  });

  it('findToolUse ne retient que le tool_use du bon nom', () => {
    expect(findToolUse(withTool('x'), 'x')?.input).toEqual({ a: 1 });
    expect(findToolUse(withTool('autre'), 'x')).toBeUndefined();
    expect(findToolUse(textOnly(), 'x')).toBeUndefined();
  });

  it('runWithToolRetry : bon tool_use → un seul appel', async () => {
    const run = jest.fn().mockResolvedValue(withTool());
    await runWithToolRetry(run, 'x');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runWithToolRetry : texte libre → UN nouvel essai, puis rend la 2e réponse', async () => {
    const onRetry = jest.fn();
    const run = jest.fn().mockResolvedValueOnce(textOnly()).mockResolvedValueOnce(withTool());
    const res = await runWithToolRetry(run, 'x', onRetry);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(findToolUse(res, 'x')).toBeDefined();
  });

  it('runWithToolRetry : jamais de 3e essai', async () => {
    const run = jest.fn().mockResolvedValue(textOnly());
    const res = await runWithToolRetry(run, 'x');
    expect(run).toHaveBeenCalledTimes(2);
    expect(findToolUse(res, 'x')).toBeUndefined();
  });

  it('runWithToolRetry : réponse tronquée (max_tokens) non relancée ici', async () => {
    const run = jest.fn().mockResolvedValue(textOnly('max_tokens'));
    await runWithToolRetry(run, 'x');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runWithToolRetry : refus (stop_reason refusal) jamais relancé', async () => {
    const onRetry = jest.fn();
    const run = jest.fn().mockResolvedValue(refusal());
    const res = await runWithToolRetry(run, 'x', onRetry);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(res.stop_reason).toBe('refusal');
  });

  it('requireToolUse : refus → erreur explicite qui nomme le refus et sa catégorie', () => {
    const err = (() => { try { requireToolUse(refusal('cyber'), 'x'); } catch (e) { return e as Error; } })();
    expect(err).toBeInstanceOf(ToolUseRefusedError);
    expect(err).toBeInstanceOf(ToolUseMissingError); // les makeError métier existants le reçoivent
    expect(err!.message).toMatch(/refus/i);
    expect(err!.message).toMatch(/catégorie cyber/);
    expect(err!.message).not.toMatch(/texte libre/);
  });

  it('requireToolUse : refus sans catégorie → message sans « catégorie null »', () => {
    expect(() => requireToolUse(refusal(null), 'x')).toThrow(ToolUseRefusedError);
    expect(() => requireToolUse(refusal(null), 'x')).not.toThrow(/null/);
  });

  it('requireToolUse : un refus prime même si un tool_use partiel est présent', () => {
    expect(() => requireToolUse(refusal('bio', true), 'x')).toThrow(ToolUseRefusedError);
  });

  it('requireToolUse : le refus passe par la classe métier de makeError', () => {
    class Mine extends Error {}
    expect(() => requireToolUse(refusal(), 'x', (e) => new Mine(e.message))).toThrow(Mine);
  });

  it('requireToolUse : erreur explicite sans tool_use, classe métier via makeError', () => {
    expect(() => requireToolUse(textOnly(), 'x')).toThrow(ToolUseMissingError);
    expect(() => requireToolUse(textOnly(), 'x')).toThrow(/n'a pas appelé l'outil x/);
    class Mine extends Error {}
    expect(() => requireToolUse(withTool('autre'), 'x', (e) => new Mine(e.message))).toThrow(Mine);
    expect(requireToolUse(withTool(), 'x').name).toBe('x');
  });

  it('strictSchemaViolations repère additionalProperties manquant et required incomplet', () => {
    const bad = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'number' } }, required: ['c'] } } }, required: ['a'] };
    expect(strictSchemaViolations(bad)).toEqual([
      '$: additionalProperties !== false',
      '$.b: absent de required',
      '$.b[]: additionalProperties !== false',
    ]);
    expect(strictSchemaViolations({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false })).toEqual([]);
  });
});
