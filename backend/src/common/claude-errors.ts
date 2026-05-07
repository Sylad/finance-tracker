import Anthropic from '@anthropic-ai/sdk';

/**
 * Détecte une erreur d'authentification Claude (HTTP 401).
 * Sépare ce cas de `isQuotaError` car la cause utilisateur est radicalement
 * différente : clé API invalide/révoquée vs solde épuisé.
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError) return true;
  if (err instanceof Anthropic.APIError && err.status === 401) return true;
  return false;
}

/**
 * Détecte une erreur de quota / rate limit Claude (HTTP 402 ou 429).
 * Ne couvre PAS l'authentification — utiliser `isAuthError` pour le 401.
 */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIError) {
    const msg = (err.message ?? '').toLowerCase();
    return err.status === 402 || msg.includes('credit') || msg.includes('quota');
  }
  return false;
}
