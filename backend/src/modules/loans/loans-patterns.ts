/**
 * Patterns regex partagés pour la détection des "paiements en N fois"
 * (pay-in-2/3/4 sans frais : 4X CB Amazon, Alma 4X, Klarna 3X, FacilyPay,
 * PayPal Pay Later…). Utilisés par :
 *   - `auto-sync.service.autoCreateLoansFromSuggestions` (filtrage à la
 *     création préventive — APEX 04 item 1 / commit b8b0301)
 *   - `loans.service.getSuspiciousLoans` (cleanup rétrospectif — APEX 04
 *     item 6)
 */
export const PAY_IN_N_PATTERN =
  /\b([2-9]\s?(X|FOIS)|N\s?FOIS|N FOIS|EN \d+ FOIS|PAY ?LATER|PAY ?PLUS ?TARD|FACILYPAY|3X|4X|3 FOIS|4 FOIS)\b/i;
