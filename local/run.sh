#!/usr/bin/env bash
# Démarre finance-tracker en local (Big-Blue). Idempotent : no-op si déjà up.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="3000"
PIDFILE="$REPO/data/.pid"
LOGDIR="$REPO/logs"
mkdir -p "$LOGDIR" "$REPO/data"

# Déjà démarré ? (santé OK) → ne rien faire
if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "Déjà démarré (port $PORT répond)."
  exit 0
fi

# Build si artefacts manquants
if [ ! -f "$REPO/backend/dist/main.js" ] || [ ! -f "$REPO/frontend/dist/index.html" ]; then
  echo "Build manquant → npm run build…"
  (cd "$REPO" && npm run build)
fi

# Chemins de données ABSOLUS (priment sur backend/.env car dotenv n'écrase pas process.env)
export DATA_DIR="$REPO/data"
export UPLOAD_DIR="$REPO/data/uploads"
export SHARED_DATA_DIR="$REPO/data/shared"

cd "$REPO/backend"
echo "Démarrage node dist/main (port $PORT)…"
# setsid → nouvelle session : le process survit à la fermeture du wsl.exe lanceur
# (un simple nohup depuis un shell qui se ferme reste fragile, cf. mémoire launcher WSL).
setsid node dist/main >>"$LOGDIR/finance.log" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# Attendre que le serveur réponde (max ~20s)
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Prêt sur http://localhost:$PORT (pid $(cat "$PIDFILE"))"
    exit 0
  fi
  sleep 1
done

echo "ERREUR : le serveur n'a pas répondu après 20s. Voir $LOGDIR/finance.log" >&2
exit 1
