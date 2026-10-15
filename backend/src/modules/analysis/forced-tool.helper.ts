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
 *      d'un texte libre), après UN seul nouvel essai (`runWithToolRetry`) ;
 *   5. `output_config: EXTRACTION_OUTPUT_CONFIG` : sur Sonnet 5.5 la réflexion adaptative
 *      est active par défaut à l'effort `high` ET compte dans `max_tokens` ; ces appels
 *      d'extraction / de classification n'ont pas besoin de raisonner longuement
 *      (effort `low`, recommandé par le guide de migration), ce qui évite aussi qu'un
 *      budget `max_tokens` serré soit mangé par la réflexion (réponse `tool_use` tronquée).
 *   Un refus (`stop_reason: 'refusal'`) n'est jamais relancé : `requireToolUse` lève
 *   `ToolUseRefusedError`.
 */
export const AUTO_TOOL_CHOICE = { type: 'auto' } as const;

/** Effort de réflexion explicite `low` pour les six appels d'extraction / classification. */
export const EXTRACTION_OUTPUT_CONFIG: Anthropic.OutputConfig = { effort: 'low' };

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

/**
 * Réponse refusée par les classifieurs de sécurité (`stop_reason: 'refusal'`, HTTP 200).
 * Hérite de `ToolUseMissingError` pour passer par les `makeError` métier existants ;
 * pas de nouvel essai : le même prompt serait refusé et un refus peut être facturé.
 */
export class ToolUseRefusedError extends ToolUseMissingError {
  constructor(toolName: string, category: string | null | undefined, explanation?: string | null) {
    super(toolName, 'refusal');
    this.message =
      `Claude a refusé la demande (stop_reason=refusal${category ? `, catégorie ${category}` : ''}` +
      `${explanation ? `, ${explanation}` : ''}) — l'outil ${toolName} n'a pas été appelé, aucune relance.`;
    this.name = 'ToolUseRefusedError';
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
 * Un refus (`refusal`) n'est pas relancé non plus : `requireToolUse` le signale.
 */
export async function runWithToolRetry(
  run: () => Promise<Anthropic.Message>,
  toolName: string,
  onRetry?: (first: Anthropic.Message) => void,
): Promise<Anthropic.Message> {
  const first = await run();
  if (findToolUse(first, toolName) || first.stop_reason === 'max_tokens' || first.stop_reason === 'refusal') return first;
  onRetry?.(first);
  return run();
}

/**
 * Renvoie le bloc `tool_use` de `toolName` ou lève une erreur explicite (refus compris)
 * (`makeError` permet à chaque service de garder sa classe d'erreur métier).
 */
export function requireToolUse(
  message: Anthropic.Message,
  toolName: string,
  makeError: (e: ToolUseMissingError) => Error = (e) => e,
): Anthropic.ToolUseBlock {
  if (message.stop_reason === 'refusal') {
    throw makeError(new ToolUseRefusedError(toolName, message.stop_details?.category, message.stop_details?.explanation));
  }
  const block = findToolUse(message, toolName);
  if (!block) throw makeError(new ToolUseMissingError(toolName, message.stop_reason));
  return block;
}
