#!/usr/bin/env bash
# Arrête finance-tracker en local.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$REPO/data/.pid"

if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  if kill "$PID" 2>/dev/null; then
    echo "Arrêté (pid $PID)."
  fi
  rm -f "$PIDFILE"
fi

# Filet de sécurité : tuer tout node dist/main résiduel de ce repo
pkill -f "node dist/main" 2>/dev/null && echo "Process résiduels nettoyés." || true
echo "Stop terminé."
