/**
 * Support de tests (exclu du build : `**\/*spec.ts`, et non joué par Jest : pas de
 * `.spec.ts`) — vérifie la forme « tool_choice auto + outil strict + consigne »
 * qui remplace le tool_choice forcé refusé par claude-sonnet-5-5 (L76).
 */

/** Défauts d'un schéma incompatible `strict: true` : objet sans `additionalProperties: false`, propriété hors `required`. */
export function strictSchemaViolations(schema: unknown, path = '$', optionalAllowed: string[] = []): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const out: string[] = [];
  const isObject = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'));
  if (isObject) {
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties !== false`);
    const props = Object.keys((s.properties as object) ?? {});
    const required = (s.required as string[]) ?? [];
    for (const p of props) {
      if (!required.includes(p) && !optionalAllowed.includes(`${path}.${p}`)) out.push(`${path}.${p}: absent de required`);
    }
  }
  for (const [k, v] of Object.entries((s.properties as object) ?? {})) {
    out.push(...strictSchemaViolations(v, `${path}.${k}`, optionalAllowed));
  }
  if (s.items) out.push(...strictSchemaViolations(s.items, `${path}[]`, optionalAllowed));
  if (Array.isArray(s.anyOf)) s.anyOf.forEach((b, i) => out.push(...strictSchemaViolations(b, `${path}|${i}`, optionalAllowed)));
  return out;
}

interface CreateParams {
  tool_choice?: unknown;
  tools?: Array<{ name: string; strict?: boolean; input_schema: unknown }>;
  output_config?: unknown;
  system?: unknown;
  messages?: Array<{ role: string }>;
  [k: string]: unknown;
}

/**
 * Une requête conforme : `tool_choice: auto`, outil `strict` au schéma complet,
 * consigne « uniquement l'outil », effort de réflexion explicite `low` (la réflexion
 * adaptative est active par défaut à `high` sur Sonnet 5.5 et compte dans `max_tokens`),
 * aucun paramètre d'échantillonnage ni préremplissage assistant. `optionalAllowed` : chemins volontairement hors `required`.
 */
export function expectAutoStrictCall(call: CreateParams, toolName: string, optionalAllowed: string[] = []): void {
  expect(call.tool_choice).toEqual({ type: 'auto' });
  expect(call.output_config).toEqual({ effort: 'low' });
  const tool = call.tools?.find((t) => t.name === toolName);
  expect(tool).toBeDefined();
  expect(call.tools).toHaveLength(1);
  expect(tool!.strict).toBe(true);
  expect(strictSchemaViolations(tool!.input_schema, '$', optionalAllowed)).toEqual([]);
  expect(String(call.system)).toContain(`Tu dois répondre en appelant l'outil ${toolName}, et uniquement lui.`);
  for (const k of ['temperature', 'top_p', 'top_k']) expect(call).not.toHaveProperty(k);
  expect(call.messages![call.messages!.length - 1].role).toBe('user'); // pas de prefill
}
