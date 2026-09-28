import type Anthropic from '@anthropic-ai/sdk';
import { MAX_OUTPUT_TOKENS, runWithMaxTokensRetry } from './max-tokens-retry.helper';

function msg(stop_reason: Anthropic.Message['stop_reason'], output = 10): Anthropic.Message {
  return {
    stop_reason,
    content: [],
    usage: { input_tokens: 100, output_tokens: output },
  } as unknown as Anthropic.Message;
}

describe('runWithMaxTokensRetry (L11)', () => {
  it('réponse complète au 1er essai → un seul appel, pas de callback', async () => {
    const run = jest.fn().mockResolvedValue(msg('tool_use'));
    const onTruncated = jest.fn();
    const res = await runWithMaxTokensRetry(run, 16384, onTruncated);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(16384);
    expect(onTruncated).not.toHaveBeenCalled();
    expect(res.stop_reason).toBe('tool_use');
  });

  it('tronquée au 1er essai → relance une fois à 64k, callback avec la réponse tronquée', async () => {
    const truncated = msg('max_tokens', 16384);
    const run = jest.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(msg('tool_use'));
    const onTruncated = jest.fn();
    const res = await runWithMaxTokensRetry(run, 16384, onTruncated);
    expect(run.mock.calls).toEqual([[16384], [MAX_OUTPUT_TOKENS]]);
    expect(MAX_OUTPUT_TOKENS).toBe(64000);
    expect(onTruncated).toHaveBeenCalledWith(truncated);
    expect(res.stop_reason).toBe('tool_use');
  });

  it('encore tronquée à 64k → renvoie la 2e réponse sans 3e essai (à l’appelant de lever)', async () => {
    const run = jest.fn().mockResolvedValue(msg('max_tokens'));
    const res = await runWithMaxTokensRetry(run, 32768, jest.fn());
    expect(run).toHaveBeenCalledTimes(2);
    expect(res.stop_reason).toBe('max_tokens');
  });

  it('budget initial déjà au plafond → pas de relance inutile', async () => {
    const run = jest.fn().mockResolvedValue(msg('max_tokens'));
    const onTruncated = jest.fn();
    await runWithMaxTokensRetry(run, MAX_OUTPUT_TOKENS, onTruncated);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onTruncated).not.toHaveBeenCalled();
  });
});
