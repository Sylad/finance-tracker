#!/bin/sh
# Déploiement appelé par `cadence deliver` (cadence.yaml) : bumpe dans
# developpeur-gitops le tag des SEULS services que la CI a construits pour ce
# sha, puis pousse — ArgoCD synchronise. La CI ne construit que le service
# modifié : bumper l'autre sur ce sha donnerait un ImagePullBackOff.
set -eu

SHA="${CADENCE_SHA:?lancé par cadence deliver}"
SHORT="${CADENCE_SHORT:?}"
ROOT="$(git rev-parse --show-toplevel)"
GITOPS="${GITOPS_DIR:-$ROOT/../developpeur-gitops}"
VALUES="$GITOPS/charts/finance-tracker/values.yaml"

run_id=$(gh run list --commit "$SHA" --workflow build.yml --json databaseId --jq '.[0].databaseId')
[ -n "$run_id" ] || { echo "deploy: aucun run de build.yml pour $SHORT" >&2; exit 1; }
built=$(gh run view "$run_id" --json jobs --jq '.jobs[] | select(.conclusion == "success") | .name' |
  sed -n 's/^Build & push \(backend\|frontend\)$/\1/p')
[ -n "$built" ] || { echo "deploy: aucune image construite pour $SHORT" >&2; exit 1; }

git -C "$GITOPS" diff --quiet && git -C "$GITOPS" diff --cached --quiet ||
  { echo "deploy: $GITOPS a des modifications non commitées" >&2; exit 1; }
git -C "$GITOPS" pull -q --ff-only

for svc in $built; do
  # Le tag du bloc « backend: » ou « frontend: », jusqu'à la clé de premier niveau suivante.
  sed -i "/^$svc:/,/^[a-z]/ s/^  tag: .*/  tag: sha-$SHORT/" "$VALUES"
  grep -A3 "^$svc:" "$VALUES" | grep -q "tag: sha-$SHORT" || { echo "deploy: tag $svc non modifié" >&2; exit 1; }
done

if git -C "$GITOPS" diff --quiet; then
  echo "deploy: tags déjà sur sha-$SHORT"
  exit 0
fi
services=$(echo $built | tr ' ' '+')
git -C "$GITOPS" commit -q -am "finance-tracker: $services sha-$SHORT — $(git log -1 --format=%s "$SHA")"
git -C "$GITOPS" push -q
echo "deploy: $services → sha-$SHORT poussé dans developpeur-gitops"
