#!/bin/sh
# Vérification appelée par `cadence deliver` : l'instance DÉPLOYÉE applique-t-elle
# la politique de cache de frontend/nginx.conf, vue à travers Cloudflare ?
# (réessayée par cadence jusqu'au délai). Lecture seule : quatre GET publics,
# aucune connexion à l'appli.
#
#   1. le document « / » porte Cache-Control: no-cache — sinon un visiteur
#      revenu garde l'ancienne appli après une livraison ;
#   2. un actif absent sous /assets/ répond 404 — jamais le repli index.html
#      en 200, que Cloudflare mettrait en cache sous un nom en .js ;
#   3. l'actif à empreinte que le document référence est servi en cache long ;
#   4. /sw.js (sans empreinte, extension que Cloudflare met en cache d'office)
#      arrive bien en no-cache jusqu'au navigateur.
#
# Les sondes 2 et 4 portent une query string unique : la clé de cache de
# Cloudflare en dépend, la réponse vient donc de l'origine et pas d'une entrée
# gardée d'avant la livraison.
#
# VERIFY_BASE_URL : autre cible (scripts/test-nginx-cache.sh y met le
# conteneur local).
set -eu

BASE="${VERIFY_BASE_URL:-https://finance.sladoire.dev}"
BUST="verif=$(date +%s)-$$"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

probe() { # url → $status, $cc (Cache-Control en minuscules), corps dans $TMP/body
  status=$(curl -sS -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' --max-time 20 "$1") ||
    { echo "verify: $1 injoignable" >&2; exit 1; }
  cc=$(tr -d '\r' < "$TMP/headers" | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p' | tail -1 | tr 'A-Z' 'a-z')
}

fail() { echo "verify: $1 — statut $status, Cache-Control « ${cc:-absent} »" >&2; exit 1; }

probe "$BASE/"
[ "$status" = 200 ] || fail "$BASE/ ne répond pas 200"
case "$cc" in
  *no-cache*) ;;
  *) fail "le document $BASE/ n'est pas servi en no-cache" ;;
esac
asset=$(grep -o '/assets/[^"]*\.js' "$TMP/body" | head -1)
[ -n "$asset" ] || { echo "verify: aucun /assets/….js référencé par $BASE/" >&2; exit 1; }

probe "$BASE/assets/absent-$$.js?$BUST"
[ "$status" = 404 ] || fail "un actif absent ($BASE/assets/absent-$$.js) ne répond pas 404"

probe "$BASE$asset"
[ "$status" = 200 ] || fail "$BASE$asset ne répond pas 200"
case "$cc" in
  *max-age=31536000*immutable*) ;;
  *) fail "l'actif à empreinte $BASE$asset n'est pas en cache long" ;;
esac

probe "$BASE/sw.js?$BUST"
[ "$status" = 200 ] || fail "$BASE/sw.js ne répond pas 200"
case "$cc" in
  *no-cache*) ;;
  *) fail "$BASE/sw.js n'arrive pas en no-cache" ;;
esac

echo "verify: cache — document et sw.js en no-cache, actif absent en 404, $asset en cache long"
