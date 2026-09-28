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
 * Message renvoyé par l'API Anthropic quand le solde de crédits est épuisé
 * (HTTP 400 `invalid_request_error` : « Your credit balance is too low to
 * access the Anthropic API… »). Phrase exacte, pas le simple mot « credit ».
 */
const CREDIT_BALANCE_TOO_LOW = /credit balance is too low/i;

/**
 * Détecte un solde / crédit API Claude épuisé — la seule erreur qui justifie
 * un 402 côté app. Reconnu par le type ou le statut de l'API :
 * - HTTP 402 ou `error.type === 'billing_error'` ;
 * - HTTP 400 dont le message API est « credit balance is too low ».
 * Ne classe PLUS en quota tout message contenant « credit » ou « quota »
 * (L12 : un relevé de carte de crédit ou une 500 serait devenu un faux 402).
 * Ne couvre ni le 401 (`isAuthError`) ni le 429 (`isRateLimitError`).
 */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err instanceof Anthropic.RateLimitError) return false; // transitoire → isRateLimitError
  if (err.status === 402 || err.type === 'billing_error') return true;
  if (err.status === 400) {
    const body = err.error as { error?: { message?: unknown } } | undefined;
    const apiMessage = typeof body?.error?.message === 'string' ? body.error.message : '';
    return CREDIT_BALANCE_TOO_LOW.test(apiMessage);
  }
  return false;
}

/**
 * Rate limit (HTTP 429) : transitoire et retryable — à distinguer du solde
 * épuisé (un 429 affiché « quota dépassé » envoyait l'utilisateur recharger
 * son compte alors qu'attendre 30 s suffisait).
 */
export function isRateLimitError(err: unknown): boolean {
  return err instanceof Anthropic.RateLimitError;
}
