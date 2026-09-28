#!/bin/sh
# Déploiement appelé par `cadence deliver` (cadence.yaml) : bumpe dans
# developpeur-gitops le tag de chaque service sur la dernière image que la CI a
# construite pour ce sha ou un de ses ancêtres, puis pousse — ArgoCD
# synchronise. La CI ne construit que le service modifié : bumper l'autre sur
# ce sha donnerait un ImagePullBackOff.
set -eu

SHA="${CADENCE_SHA:?lancé par cadence deliver}"
SHORT="${CADENCE_SHORT:?}"
ROOT="$(git rev-parse --show-toplevel)"
GITOPS="${GITOPS_DIR:-$ROOT/../developpeur-gitops}"
VALUES="$GITOPS/charts/finance-tracker/values.yaml"

git -C "$GITOPS" diff --quiet && git -C "$GITOPS" diff --cached --quiet ||
  { echo "deploy: $GITOPS a des modifications non commitées" >&2; exit 1; }
git -C "$GITOPS" pull -q --ff-only

# Pour chaque service, la dernière image construite avec succès par un ancêtre
# de ce sha (ou ce sha lui-même) : un commit qui ne touche ni backend/ ni
# frontend/ ne reconstruit rien, et les images construites avant lui restent
# à livrer. Runs du plus récent au plus ancien.
runs=$(gh run list --workflow build.yml --status success --limit 100 --json databaseId,headSha \
  --jq '.[] | "\(.databaseId) \(.headSha)"')
backend_sha="" frontend_sha=""
while read -r run_id head; do
  [ -n "$run_id" ] || continue
  git merge-base --is-ancestor "$head" "$SHA" 2>/dev/null || continue
  short=$(echo "$head" | cut -c1-7) # même coupe que le tag de la CI
  for svc in $(gh run view "$run_id" --json jobs --jq '.jobs[] | select(.conclusion == "success") | .name' |
    sed -n 's/^Build & push \(backend\|frontend\)$/\1/p'); do
    case $svc in
      backend) [ -n "$backend_sha" ] || backend_sha=$short ;;
      frontend) [ -n "$frontend_sha" ] || frontend_sha=$short ;;
    esac
  done
  [ -n "$backend_sha" ] && [ -n "$frontend_sha" ] && break
done <<EOF
$runs
EOF

bumped=""
for svc in backend frontend; do
  if [ "$svc" = backend ]; then new=$backend_sha; else new=$frontend_sha; fi
  [ -n "$new" ] || { echo "deploy: aucune image $svc construite pour un ancêtre de $SHORT" >&2; exit 1; }
  # Le tag du bloc « backend: » ou « frontend: », jusqu'à la clé de premier niveau suivante.
  cur=$(sed -n "/^$svc:/,/^[a-z]/ s/^  tag: sha-//p" "$VALUES")
  [ "$cur" = "$new" ] && continue
  # Jamais de retour en arrière : une image plus ancienne que celle déployée reste de côté.
  if git merge-base --is-ancestor "$new" "$cur" 2>/dev/null; then
    echo "deploy: $svc reste sur sha-$cur (sha-$new est plus ancien)"
    continue
  fi
  sed -i "/^$svc:/,/^[a-z]/ s/^  tag: .*/  tag: sha-$new/" "$VALUES"
  grep -A3 "^$svc:" "$VALUES" | grep -q "tag: sha-$new" || { echo "deploy: tag $svc non modifié" >&2; exit 1; }
  bumped="$bumped $svc→sha-$new"
done

if [ -z "$bumped" ]; then
  echo "deploy: rien à livrer, les tags sont déjà à jour"
  exit 0
fi
git -C "$GITOPS" commit -q -am "finance-tracker:$bumped — $(git log -1 --format=%s "$SHA")"
git -C "$GITOPS" push -q
echo "deploy:$bumped poussé dans developpeur-gitops"
