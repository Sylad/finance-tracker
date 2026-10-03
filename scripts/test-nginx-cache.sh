#!/usr/bin/env bash
# Teste frontend/nginx.conf sur un VRAI nginx : les en-têtes de cache et le
# repli SPA, cas par cas, sur le dist/ réellement construit.
#
# Rejoue aussi scripts/verify-cache.sh (le contrôle d'effet de la livraison)
# contre ce conteneur.
#
# Pourquoi : sans Cache-Control, un navigateur garde index.html par fraîcheur
# heuristique et montre l'ancienne appli après une livraison ; et si un actif
# absent répond le repli HTML en 200, Cloudflare met ce HTML en cache sous le
# nom d'un .js — page blanche.
#
# Ce que fait le script :
#   1. `nginx -t` sur la configuration, dans l'image de base du Dockerfile ;
#   2. démarre un conteneur de cette image qui sert frontend/dist avec
#      frontend/nginx.conf, montés en lecture seule ;
#   3. interroge chaque cas avec `curl -sI` et compare statut, Content-Type et
#      Cache-Control à l'attendu ;
#   4. supprime le conteneur (trap), même en cas d'échec.
#
# Le backend n'existe pas ici. La configuration est chargée telle quelle : le
# nom `finance-backend` de ses proxy_pass est résolu par --add-host vers
# 127.0.0.1 (dans le cluster, c'est le Service du même nom qui le résout), et
# un faux backend — un second `server` nginx sur le port 3000 du même
# conteneur, ajouté dans conf.d — répond à /api/ pour vérifier que le proxy
# passe toujours et ne reçoit aucun en-tête de cache.
#
# Prérequis : Docker, curl, et frontend/dist construit (`npm run build` dans
# frontend/). Code de sortie : 0 tout vert, 1 au moins un échec, 2 prérequis.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${NGINX_CONF:-$ROOT/frontend/nginx.conf}" # NGINX_CONF : rejouer sur une autre version du fichier
DIST="$ROOT/frontend/dist"
IMAGE="$(sed -n 's/^FROM \(nginx[^ ]*\).*/\1/p' "$ROOT/frontend/Dockerfile" | tail -1)"
NAME="finance-nginx-cache-test-$$"

IMMUTABLE="public, max-age=31536000, immutable"

[ -f "$CONF" ] || { echo "test-nginx-cache : $CONF introuvable" >&2; exit 2; }
[ -n "$IMAGE" ] || { echo "test-nginx-cache : image nginx introuvable dans frontend/Dockerfile" >&2; exit 2; }
[ -f "$DIST/index.html" ] ||
  { echo "test-nginx-cache : frontend/dist absent — lancer \`npm run build\` dans frontend/" >&2; exit 2; }
# Un DOCKER_API_VERSION figé trop bas dans le shell (vécu Big-Blue : 1.43 pour
# un démon qui exige 1.44) rend le démon injoignable : on réessaie sans lui.
docker version >/dev/null 2>&1 || { unset DOCKER_API_VERSION; docker version >/dev/null 2>&1; } ||
  { echo "test-nginx-cache : démon Docker injoignable (docker version)" >&2; exit 2; }

TMP="$(mktemp -d)"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
fails=0

# --- 1. syntaxe, dans l'image du Dockerfile ---------------------------------
if docker run --rm --add-host finance-backend:127.0.0.1 \
  -v "$CONF:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" nginx -t > "$TMP/nginx-t" 2>&1; then
  echo "ok   nginx -t ($IMAGE)"
else
  echo "FAIL nginx -t ($IMAGE)"; sed 's/^/     | /' "$TMP/nginx-t"; exit 1
fi

# --- 2. conteneur : dist/ réel + configuration + faux backend ---------------
cat > "$TMP/stub-backend.conf" <<'EOF'
server {
    listen 3000;
    location / {
        default_type application/json;
        return 200 '{"stub":"$request_uri"}';
    }
}
EOF
docker run -d --name "$NAME" --add-host finance-backend:127.0.0.1 -p 127.0.0.1::80 \
  -v "$CONF:/etc/nginx/conf.d/default.conf:ro" \
  -v "$TMP/stub-backend.conf:/etc/nginx/conf.d/stub-backend.conf:ro" \
  -v "$DIST:/usr/share/nginx/html:ro" "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 80/tcp | sed -n 's/.*:\([0-9]*\)$/\1/p' | head -1)"
BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 50); do
  curl -s -o /dev/null --max-time 2 "$BASE/" && break
  sleep 0.2
done

# --- 3. les cas -------------------------------------------------------------
hdr() { sed -n "s/^$1: *//Ip" "$TMP/h" | tail -1; }

req() { # chemin [options curl…] → $status $ctype $cc $etag $lastmod
  local path=$1; shift
  curl -sI --max-time 10 "$@" "$BASE$path" | tr -d '\r' > "$TMP/h" || true
  status="$(awk 'NR==1 { print $2 }' "$TMP/h")"
  ctype="$(hdr content-type)"; cc="$(hdr cache-control)"
  etag="$(hdr etag)"; lastmod="$(hdr last-modified)"
}

row() { # ${#2} compte des caractères (pas des octets) : colonnes alignées malgré les accents
  printf '%-4s %s%*s %-4s %-25s %s\n' "$1" "$2" $((46 - ${#2})) "" "$3" "$4" "$5"
}

expect() { # libellé chemin statut content-type cache-control [options curl…] ; « - » = en-tête absent
  local label=$1 path=$2 want_status=$3 want_ctype=$4 want_cc=$5; shift 5
  req "$path" "$@"
  if [ "$status" = "$want_status" ] && [ "${ctype:--}" = "$want_ctype" ] && [ "${cc:--}" = "$want_cc" ]; then
    row ok "$label" "$status" "${ctype:--}" "${cc:--}"
  else
    row FAIL "$label" "$status" "${ctype:--}" "${cc:--}"
    row "" "  attendu" "$want_status" "$want_ctype" "$want_cc"
    fails=$((fails + 1))
  fi
}

check() { # libellé condition…
  local label=$1; shift
  if "$@"; then echo "ok   $label"; else echo "FAIL $label"; fails=$((fails + 1)); fi
}

HASHED_JS="$(grep -o '/assets/[^"]*\.js' "$DIST/index.html" | head -1)"
HASHED_CSS="$(grep -o '/assets/[^"]*\.css' "$DIST/index.html" | head -1)"
[ -n "$HASHED_JS" ] && [ -n "$HASHED_CSS" ] ||
  { echo "test-nginx-cache : aucun actif à empreinte référencé par dist/index.html" >&2; exit 2; }

echo
row "" "cas" "code" "Content-Type" "Cache-Control"

# Le document : toujours revalidé, quel que soit le chemin qui y mène.
expect "/" / 200 text/html no-cache
doc_etag=$etag doc_lastmod=$lastmod
expect "/index.html" /index.html 200 text/html no-cache
expect "route profonde /loans/2026/detail" /loans/2026/detail 200 text/html no-cache
expect "/ conditionnel If-None-Match" / 304 - no-cache -H "If-None-Match: $doc_etag"
expect "/ conditionnel If-Modified-Since" / 304 - no-cache -H "If-Modified-Since: $doc_lastmod"

# Les actifs à empreinte : cache long ; absents : 404, jamais le repli HTML,
# et un 404 qu'aucun cache ne garde (Cloudflare garde 3 min un 404 sans
# consigne : pendant un rollout, l'ancien pod répondrait 404 pour le nouveau
# fichier et ce 404 resterait servi après la bascule).
expect "actif à empreinte (.js)" "$HASHED_JS" 200 application/javascript "$IMMUTABLE"
expect "actif à empreinte, conditionnel" "$HASHED_JS" 304 - "$IMMUTABLE" -H "If-None-Match: $etag"
expect "actif à empreinte (.css)" "$HASHED_CSS" 200 text/css "$IMMUTABLE"
expect "actif absent /assets/absent-0000.js" /assets/absent-0000.js 404 text/html no-store
expect "actif absent, avec query string" "/assets/absent-0000.css?v=1" 404 text/html no-store

# Les fichiers statiques sans empreinte : pas plus longtemps que l'appli.
expect "/sw.js (service worker)" /sw.js 200 application/javascript no-cache
expect "/manifest.webmanifest" /manifest.webmanifest 200 application/octet-stream no-cache
expect "/favicon.ico" /favicon.ico 200 image/x-icon no-cache
expect "/icon.svg" /icon.svg 200 image/svg+xml no-cache
expect "/plan-data/plan.json" /plan-data/plan.json 200 application/json no-cache
expect "/nouveautes-data/nouveautes.json" /nouveautes-data/nouveautes.json 200 application/json no-cache

# L'API : même proxy qu'avant, aucun en-tête de cache ajouté.
expect "/api/health (faux backend)" /api/health 200 application/json -
expect "/api/events (faux backend)" /api/events 200 application/json -
check "/api/health : le chemin arrive entier au backend" \
  bash -c "curl -s --max-time 10 '$BASE/api/health' | grep -q '\"stub\":\"/api/health\"'"
check "/api/events : le chemin arrive entier au backend" \
  bash -c "curl -s --max-time 10 '$BASE/api/events' | grep -q '\"stub\":\"/api/events\"'"
check "/ : ETag et Last-Modified présents (304 possible)" test -n "$doc_etag" -a -n "$doc_lastmod"

# Exhaustif : CHAQUE fichier de dist/. Sous assets/ → cache long ; ailleurs →
# no-cache. Un nouveau fichier ou dossier du build est donc couvert d'office.
echo
n_assets=0 n_other=0 bad=""
while IFS= read -r f; do
  path="/${f#"$DIST"/}"
  req "$path"
  case "$path" in
    /assets/*) want=$IMMUTABLE; n_assets=$((n_assets + 1)) ;;
    *) want=no-cache; n_other=$((n_other + 1)) ;;
  esac
  [ "$status" = 200 ] && [ "$cc" = "$want" ] || bad="$bad
     | $path → $status « ${cc:--} », attendu 200 « $want »"
done < <(find "$DIST" -type f | sort)
if [ -z "$bad" ]; then
  echo "ok   tout dist/ : $n_assets fichiers sous assets/ en cache long, $n_other autres en no-cache"
else
  echo "FAIL tout dist/ ($n_assets sous assets/, $n_other autres) :$bad"; fails=$((fails + 1))
fi

# Le contrôle d'effet de la livraison (cadence.yaml → scripts/verify-cache.sh),
# rejoué ici contre le conteneur : ce qu'il exigera de la prod passe en local.
if VERIFY_BASE_URL="$BASE" sh "$ROOT/scripts/verify-cache.sh" > "$TMP/verify" 2>&1; then
  echo "ok   scripts/verify-cache.sh contre le conteneur"
else
  echo "FAIL scripts/verify-cache.sh contre le conteneur"; sed 's/^/     | /' "$TMP/verify"; fails=$((fails + 1))
fi

# Toute empreinte de assets/ est bien une empreinte : le nom du fichier change
# quand son contenu change (convention Vite <nom>-<hash 8 car.>.<ext>). Un
# fichier copié tel quel dans assets/ serait gardé un an à tort.
unhashed="$(find "$DIST/assets" -type f | grep -Ev -- '-[A-Za-z0-9_-]{8}\.[a-z0-9]+$' || true)"
check "assets/ ne contient que des fichiers à empreinte" test -z "$unhashed"
[ -z "$unhashed" ] || echo "$unhashed" | sed 's/^/     | /'

echo
[ "$fails" -eq 0 ] && echo "test-nginx-cache : tout est vert" || { echo "test-nginx-cache : $fails échec(s)"; exit 1; }
