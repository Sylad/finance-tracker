#!/usr/bin/env bash
# Rapatriement one-shot des données finance-tracker du NAS vers le PC dev local.
# Idempotent (rsync). NAS = source de vérité : écrase les fichiers locaux divergents avec l'état du NAS.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# user/port/identité viennent de ~/.ssh/config (Host nas) — surcharger via NAS_HOST si besoin.
NAS_HOST="${NAS_HOST:-nas}"
NAS_DATA="/volume2/docker/developpeur/data/finance/"
NAS_SHARED="/volume2/docker/developpeur/data/shared/claude-shared.json"
NAS_ENV="/volume2/docker/developpeur/finance-tracker-v2/backend/.env"

echo "==> Rapatriement données finance depuis le NAS ($NAS_HOST)"
mkdir -p "$REPO/data/shared" "$REPO/data/uploads"

# Données applicatives (relevés, budgets, snapshots, uploads...)
rsync -az --info=stats1 --rsync-path=/usr/bin/rsync -e ssh "$NAS_HOST:$NAS_DATA" "$REPO/data/"

# Solde Claude partagé → copie standalone locale
rsync -az --rsync-path=/usr/bin/rsync -e ssh "$NAS_HOST:$NAS_SHARED" "$REPO/data/shared/" || \
  echo "   (claude-shared.json absent sur le NAS, ignoré)"

# .env : récupérer la vraie ANTHROPIC_API_KEY + APP_PIN (sans écraser un .env local existant)
if [ -f "$REPO/backend/.env" ]; then
  echo "==> backend/.env existe déjà localement, conservé tel quel"
else
  echo "==> Récupération de backend/.env depuis le NAS"
  ssh "$NAS_HOST" "cat '$NAS_ENV'" > "$REPO/backend/.env"
  # Supprimer les clés que la config locale doit contrôler (dotenv = first-wins)
  sed -i '/^NODE_ENV=/d; /^PORT=/d; /^CORS_ORIGIN=/d; /^DATA_DIR=/d; /^UPLOAD_DIR=/d; /^SHARED_DATA_DIR=/d' "$REPO/backend/.env"
  # Ajouter un bloc d'overrides locaux avec chemins absolus
  cat >> "$REPO/backend/.env" <<ENVBLOCK

# --- Overrides locaux (PC dev) ---
NODE_ENV=production
PORT=3000
CORS_ORIGIN=http://localhost:3000
DATA_DIR=$REPO/data
UPLOAD_DIR=$REPO/data/uploads
SHARED_DATA_DIR=$REPO/data/shared
ENVBLOCK
fi

echo "==> Terminé."
echo "    Données : $REPO/data"
echo "    Env     : $REPO/backend/.env"
