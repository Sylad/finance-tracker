import { IncomingMessage } from 'http';

/**
 * Le mode démo FORCÉ (lecture seule, dataset isolé, PIN contourné) est-il actif
 * pour cette requête ?
 *
 * Décision (L1, 2026-09-28) : on ne regarde QUE ce que le client ne peut pas
 * choisir pour sortir de la démo.
 *
 * - `X-Forwarded-Host` est IGNORÉ. Ni le nginx du frontend ni cloudflared ne le
 *   réécrivent : la valeur envoyée par le navigateur arrivait telle quelle au
 *   backend. Vérifié le 2026-09-28 sur finance.sladoire.dev :
 *   `X-Forwarded-Host: example.com` → `/api/demo/status` passait à
 *   `forced:false` (sortie de la démo, puis mur du PIN). En local, l'inverse
 *   (`X-Forwarded-Host: x.trycloudflare.com`) contournait le PIN.
 * - `Host` fait foi. Derrière le tunnel, c'est le nom routé par Cloudflare
 *   (cloudflared le conserve, `httpHostHeader` vide par défaut ; le nginx du
 *   frontend le recopie via `proxy_set_header Host $host`) : un visiteur qui
 *   change le Host n'atteint plus la route finance.sladoire.dev du tunnel.
 *   Un client en accès direct peut forger son Host, mais forger un hôte démo
 *   ne fait qu'ENTRER en démo : données synthétiques, écritures refusées par
 *   DemoWriteGuard, claude-usage isolé — il n'y gagne rien.
 * - `demoForcedAll` (env `DEMO_FORCED=true`) force toute l'instance côté
 *   serveur, sans dépendre d'aucun en-tête. Désactivé par défaut : l'instance
 *   locale (vraies données) garde exactement son comportement.
 */
export function isForcedDemoRequest(
  req: Pick<IncomingMessage, 'headers'>,
  forcedHosts: string[],
  forcedAll: boolean,
): boolean {
  if (forcedAll) return true;
  const host = (req.headers.host ?? '').toLowerCase();
  if (!host) return false;
  return forcedHosts.some((p) => p && host.includes(p.toLowerCase()));
}
