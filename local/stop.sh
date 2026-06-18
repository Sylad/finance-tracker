#!/usr/bin/env bash
# Arrête finance-tracker en local.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$REPO/data/.pid"

_stopped_cleanly=false
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  if kill "$PID" 2>/dev/null; then
    echo "Arrêté (pid $PID)."
    _stopped_cleanly=true
  fi
  rm -f "$PIDFILE"
fi

# Filet de sécurité : tuer tout node dist/main résiduel uniquement si le pidfile n'a pas suffi
if [ "$_stopped_cleanly" = false ]; then
  pkill -f "node dist/main" 2>/dev/null && echo "Process résiduels nettoyés." || true
fi
echo "Stop terminé."
