import type Anthropic from '@anthropic-ai/sdk';

/** Plafond de tokens de sortie de claude-sonnet-4-5 (64k). */
export const MAX_OUTPUT_TOKENS = 64000;

/**
 * Appelle `run(initialMaxTokens)` ; si la réponse est tronquée
 * (`stop_reason === 'max_tokens'`), relance UNE fois au plafond de 64k.
 * `onTruncated` reçoit la réponse tronquée (ses tokens sont facturés : à
 * enregistrer, et à journaliser). Renvoie la dernière réponse — si elle est
 * encore tronquée, c'est à l'appelant de lever son erreur métier.
 * Partagé par le flux bancaire (phase 1) et l'amortissement (L11).
 */
export async function runWithMaxTokensRetry(
  run: (maxTokens: number) => Promise<Anthropic.Message>,
  initialMaxTokens: number,
  onTruncated: (truncated: Anthropic.Message) => void,
): Promise<Anthropic.Message> {
  const first = await run(initialMaxTokens);
  if (first.stop_reason !== 'max_tokens' || initialMaxTokens >= MAX_OUTPUT_TOKENS) return first;
  onTruncated(first);
  return run(MAX_OUTPUT_TOKENS);
}
