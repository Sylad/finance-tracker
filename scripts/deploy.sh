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

# L46 — attendre les runs CI encore en cours d'un ancêtre de ce sha. cadence
# n'attend que le run de CE sha : si un commit qui ne touche que le plan est
# poussé juste après un commit backend/frontend, son run (vide) finit avant
# celui qui construit l'image, et sans cette attente on concluait « rien à
# livrer » (vécu warhammer 01-10, correctif porté de warhammer40k). Borné
# par DEPLOY_CI_TIMEOUT (sous le deployTimeout de cadence, 1800 s) ; un run
# qui finit en échec bloque plus bas tant qu'il n'est pas remplacé.
deadline=$(( $(date +%s) + ${DEPLOY_CI_TIMEOUT:-1200} ))
while :; do
  pending_runs=$(gh run list --workflow build.yml --limit 100 --json databaseId,headSha,status \
    --jq '.[] | select(.status != "completed") | "\(.databaseId) \(.headSha)"')
  pending=""
  while read -r run_id head; do
    [ -n "$run_id" ] || continue
    git merge-base --is-ancestor "$head" "$SHA" 2>/dev/null || continue
    pending="$pending $run_id($(echo "$head" | cut -c1-7))"
  done <<EOF
$pending_runs
EOF
  [ -n "$pending" ] || break
  [ "$(date +%s)" -lt "$deadline" ] ||
    { echo "deploy: runs CI d'ancêtres de $SHORT toujours en cours :$pending" >&2; exit 1; }
  echo "deploy: attente des runs CI en cours d'ancêtres de $SHORT :$pending"
  sleep "${DEPLOY_CI_POLL:-20}"
done

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

# L46 — un build rouge PAS ENCORE REMPLACÉ bloque la livraison (sinon on
# livrerait en silence une image antérieure à ce commit). Règle : un run
# terminé ≠ success, dont le sha est un ancêtre de ce sha (ou ce sha), bloque
# pour chaque service qu'il n'a pas construit — job « Build & push <svc> » non
# vert ; détection rouge, plusieurs builds rouges ou run sans aucun job = les
# deux services ; un job étranger au build, rouge seul, ne bloque pas —
# SAUF si ce service a depuis une image plus récente : l'image retenue
# ci-dessus ou celle déjà déployée descend du sha du run rouge. Les vieux
# rouges réparés par un build ultérieur ne comptent donc pas.
failed_runs=$(gh run list --workflow build.yml --limit 100 --json databaseId,headSha,status,conclusion,url \
  --jq '.[] | select(.status == "completed" and .conclusion != "success") | "\(.databaseId) \(.headSha) \(.url)"')
cur_backend=$(sed -n "/^backend:/,/^[a-z]/ s/^  tag: sha-//p" "$VALUES")
cur_frontend=$(sed -n "/^frontend:/,/^[a-z]/ s/^  tag: sha-//p" "$VALUES")
replaced() { # sha service : une image retenue ou déployée de ce service descend-elle de sha ?
  if [ "$2" = backend ]; then set -- "$1" "$backend_sha" "$cur_backend"; else set -- "$1" "$frontend_sha" "$cur_frontend"; fi
  { [ -n "$2" ] && git merge-base --is-ancestor "$1" "$2" 2>/dev/null; } ||
    { [ -n "$3" ] && git merge-base --is-ancestor "$1" "$3" 2>/dev/null; }
}
blocking=""
while read -r run_id head url; do
  [ -n "$run_id" ] || continue
  git merge-base --is-ancestor "$head" "$SHA" 2>/dev/null || continue
  replaced "$head" backend && replaced "$head" frontend && continue # sans appel à gh
  # Jobs non verts, ou « (aucun job) » pour un run annulé avant de démarrer.
  red_jobs=$(gh run view "$run_id" --json jobs \
    --jq 'if (.jobs | length) == 0 then "(aucun job)" else .jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name end' |
    grep -E '^(Build & push|Detect changed services|\(aucun job\))' || true)
  case "$red_jobs" in
    "Build & push backend") svcs=backend ;;
    "Build & push frontend") svcs=frontend ;;
    "") continue ;; # seuls des jobs étrangers au build sont rouges : aucune image manquante
    *) svcs="backend frontend" ;;
  esac
  for svc in $svcs; do
    replaced "$head" "$svc" && continue
    blocking="$blocking
  run $run_id (sha-$(echo "$head" | cut -c1-7), $svc) $url
    → pour débloquer : gh run rerun $run_id --failed, ou un nouveau commit qui touche $svc/"
  done
done <<EOF
$failed_runs
EOF
if [ -n "$blocking" ]; then
  echo "deploy: build CI en échec, pas encore remplacé, pour un ancêtre de $SHORT :$blocking" >&2
  exit 1
fi

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
