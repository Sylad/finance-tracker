#!/usr/bin/env bash
# Démo locale ISOLÉE pour la revue UX automatique (cadence orchestrate.ux, L60).
#
# Tourne sur Big-Blue, là où vivent les vraies données (data-local/). Garanties :
#   - le backend est compilé dans <DATA_DIR>/build, jamais dans backend/dist (celui de l'instance réelle) ;
#   - DATA_DIR est un dossier jetable HORS de data-local/ et de data/ (défaut :
#     ../tmp/finance-ux-demo, le dossier temporaire du projet), rempli à chaque
#     lancement depuis les fixtures VERSIONNÉES (backend/src/modules/demo/demo-fixtures.json) ;
#   - DEMO_FORCED=true (démo verrouillée, lecture seule), APP_PIN vide, pas de
#     clé Anthropic : rien à saisir, rien à dépenser ;
#   - ports distincts d'ol-companion et de l'instance réelle (3000/4200) :
#     backend 3052, frontend Vite 5192.
# Preuve : backend/src/modules/demo/ux-demo.spec.ts.
#
#   local/ux-demo.sh               lance backend + frontend, au premier plan (Ctrl-C = tout arrêter)
#   local/ux-demo.sh --print-env   affiche l'environnement qui serait utilisé, sans rien lancer
#   UX_DEMO_DIR=/chemin local/ux-demo.sh   autre dossier de données (refusé s'il touche data-local/ ou data/)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACK_PORT=3052
FRONT_PORT=5192

DEMO_BASE="$(realpath -m "${UX_DEMO_DIR:-$REPO/../tmp/finance-ux-demo}")"

# Refuse un dossier qui est, contient ou se trouve dans data-local/ ou data/.
for protected in "$REPO/data-local" "$REPO/data" "$REPO/backend/data"; do
  p="$(realpath -m "$protected")"
  case "$DEMO_BASE/" in "$p/"*) echo "ERREUR : UX_DEMO_DIR ($DEMO_BASE) est dans $p" >&2; exit 2;; esac
  case "$p/" in "$DEMO_BASE/"*) echo "ERREUR : UX_DEMO_DIR ($DEMO_BASE) contient $p" >&2; exit 2;; esac
done

print_env() {
  cat <<ENV
DATA_DIR=$DEMO_BASE
UPLOAD_DIR=$DEMO_BASE/uploads
BUILD_DIR=$DEMO_BASE/build
DEMO_FORCED=true
APP_PIN=
ANTHROPIC_API_KEY=
PORT=$BACK_PORT
FRONT_PORT=$FRONT_PORT
CORS_ORIGIN=http://localhost:$FRONT_PORT
VITE_API_TARGET=http://localhost:$BACK_PORT
ENV
}

if [ "${1:-}" = "--print-env" ]; then
  print_env
  exit 0
fi

# Variables exportées VIDES incluses : dotenv n'écrase pas process.env, donc
# backend/.env (vrai PIN, vraie clé) ne passe pas.
while IFS='=' read -r k v; do export "$k=$v"; done < <(print_env)

# Jeu de démo frais à chaque lancement : seul <DATA_DIR>/demo est effacé.
mkdir -p "$DATA_DIR/uploads"
rm -rf "$DATA_DIR/demo"

# Compilation dans un dossier PROPRE à la démo : backend/dist est celui que
# local/run.sh exécute avec les vraies données, il n'est ni effacé ni réécrit ici.
echo "Build backend (dans $BUILD_DIR)…"
rm -rf "$BUILD_DIR"
(cd "$REPO/backend" && npx tsc -p tsconfig.build.json --outDir "$BUILD_DIR" --tsBuildInfoFile "$BUILD_DIR/.tsbuildinfo" \
  && (cd src && find . -name '*.json' -exec cp --parents {} "$BUILD_DIR" \;))

# Les dépendances du backend se résolvent dans backend/node_modules AVANT tout
# node_modules d'un dossier parent (Node remonte les parents avant NODE_PATH) :
# la démo charge les mêmes versions que le code testé.
ln -s "$REPO/backend/node_modules" "$BUILD_DIR/node_modules"

pids=()
# Tue un processus et ses descendants (npm run dev → vite → esbuild) : un simple
# kill du pid noté laisserait un Vite orphelin qui garde le port.
kill_tree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$c"; done
  kill "$1" 2>/dev/null || true
}
cleanup() { for p in "${pids[@]:-}"; do kill_tree "$p"; done; }
trap cleanup EXIT INT TERM

(cd "$REPO/backend" && NODE_PATH="$REPO/backend/node_modules" exec node "$BUILD_DIR/main") &
pids+=($!)

for _ in $(seq 1 30); do
  curl -sf "http://localhost:$BACK_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://localhost:$BACK_PORT/api/health" >/dev/null \
  || { echo "ERREUR : backend de démo muet sur $BACK_PORT" >&2; exit 1; }
curl -sf -X POST "http://localhost:$BACK_PORT/api/demo/seed" >/dev/null

echo "Démo isolée prête : http://localhost:$FRONT_PORT (données : $DATA_DIR/demo)"
(cd "$REPO/frontend" && exec npm run dev -- --port "$FRONT_PORT" --strictPort) &
pids+=($!)
wait
