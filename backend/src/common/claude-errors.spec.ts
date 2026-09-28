import Anthropic from '@anthropic-ai/sdk';
import { isAuthError, isQuotaError, isRateLimitError } from './claude-errors';

/** Construit l'erreur exactement comme le SDK à partir d'une réponse HTTP. */
function apiError(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message } },
    undefined,
    new Headers(),
  );
}

describe('isQuotaError (L12)', () => {
  it('402 billing_error → quota', () => {
    expect(isQuotaError(apiError(402, 'billing_error', 'Payment required'))).toBe(true);
  });

  it('type billing_error quel que soit le statut → quota', () => {
    expect(isQuotaError(apiError(400, 'billing_error', 'Billing issue'))).toBe(true);
  });

  it('400 « credit balance is too low » (forme réelle du solde épuisé) → quota', () => {
    const err = apiError(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    );
    expect(isQuotaError(err)).toBe(true);
  });

  it('400 dont le message mentionne une carte de crédit → PAS quota', () => {
    const err = apiError(400, 'invalid_request_error', 'Invalid document: credit card statement page 3 could not be parsed');
    expect(isQuotaError(err)).toBe(false);
  });

  it('500 dont le message contient « credit » ou « quota » → PAS quota', () => {
    expect(isQuotaError(apiError(500, 'api_error', 'Internal error while processing credit data'))).toBe(false);
    expect(isQuotaError(apiError(500, 'api_error', 'quota service unavailable'))).toBe(false);
  });

  it('529 overloaded → PAS quota', () => {
    expect(isQuotaError(apiError(529, 'overloaded_error', 'Overloaded'))).toBe(false);
  });

  it('429 rate limit → PAS quota (transitoire)', () => {
    const err = apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit');
    expect(isQuotaError(err)).toBe(false);
    expect(isRateLimitError(err)).toBe(true);
  });

  it('erreur non-API contenant « credit » → PAS quota', () => {
    expect(isQuotaError(new Error('credit balance is too low'))).toBe(false);
  });
});

describe('isAuthError', () => {
  it('401 → auth, pas quota', () => {
    const err = apiError(401, 'authentication_error', 'invalid x-api-key');
    expect(isAuthError(err)).toBe(true);
    expect(isQuotaError(err)).toBe(false);
  });
});
