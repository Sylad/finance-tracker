import type Anthropic from '@anthropic-ai/sdk';

/**
 * claude-sonnet-5-5 refuse `tool_choice: { type: 'tool' | 'any' }` (400, L76).
 * Forme de remplacement, commune à tous les appels « un seul outil attendu » :
 *   1. `tool_choice: { type: 'auto' }` (`AUTO_TOOL_CHOICE`) ;
 *   2. la définition de l'outil porte `strict: true` : arguments conformes au schéma
 *      (`additionalProperties: false` sur chaque objet, `required` complet) ;
 *   3. une consigne explicite dans le prompt (`onlyToolInstruction`) ;
 *   4. un contrôle côté code (`requireToolUse`) : `auto` ne GARANTIT pas l'appel,
 *      donc pas de bloc `tool_use` du bon nom = erreur explicite (jamais de parse
 *      d'un texte libre), après UN seul nouvel essai (`runWithToolRetry`).
 */
export const AUTO_TOOL_CHOICE = { type: 'auto' } as const;

/** Consigne à ajouter au system prompt de tout appel qui n'attend que cet outil. */
export function onlyToolInstruction(toolName: string): string {
  return `Tu dois répondre en appelant l'outil ${toolName}, et uniquement lui.`;
}

export class ToolUseMissingError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly stopReason: string | null,
  ) {
    super(
      `Claude n'a pas appelé l'outil ${toolName} (stop_reason=${stopReason ?? 'null'}) — ` +
        'réponse en texte libre ignorée.',
    );
    this.name = 'ToolUseMissingError';
  }
}

export function findToolUse(message: Anthropic.Message, toolName: string): Anthropic.ToolUseBlock | undefined {
  return message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName,
  );
}

/**
 * Appelle `run()` ; si la réponse ne contient aucun `tool_use` de `toolName`,
 * relance UNE fois. Une réponse tronquée (`max_tokens`) n'est pas relancée ici :
 * c'est le rôle de `runWithMaxTokensRetry` / de l'appelant (budget différent).
 */
export async function runWithToolRetry(
  run: () => Promise<Anthropic.Message>,
  toolName: string,
  onRetry?: (first: Anthropic.Message) => void,
): Promise<Anthropic.Message> {
  const first = await run();
  if (findToolUse(first, toolName) || first.stop_reason === 'max_tokens') return first;
  onRetry?.(first);
  return run();
}

/**
 * Renvoie le bloc `tool_use` de `toolName` ou lève une erreur explicite
 * (`makeError` permet à chaque service de garder sa classe d'erreur métier).
 */
export function requireToolUse(
  message: Anthropic.Message,
  toolName: string,
  makeError: (e: ToolUseMissingError) => Error = (e) => e,
): Anthropic.ToolUseBlock {
  const block = findToolUse(message, toolName);
  if (!block) throw makeError(new ToolUseMissingError(toolName, message.stop_reason));
  return block;
}
