#!/bin/sh
# Vérification appelée par `cadence deliver` : les pods tournent-ils les images
# que developpeur-gitops déclare ? (réessayée par cadence jusqu'au délai)
# Lecture seule sur le cluster dark-blue (namespace preprod).
set -eu

ROOT="$(git rev-parse --show-toplevel)"
VALUES="${GITOPS_DIR:-$ROOT/../developpeur-gitops}/charts/finance-tracker/values.yaml"

[ "$(kubectl config current-context)" = "dark-blue" ] || { echo "verify: contexte kubectl inattendu" >&2; exit 1; }
for svc in backend frontend; do
  want=$(sed -n "/^$svc:/,/^[a-z]/ s/^  tag: //p" "$VALUES")
  got=$(kubectl -n preprod get deploy "finance-$svc" -o jsonpath='{.spec.template.spec.containers[0].image}')
  case "$got" in
    *":$want") ;;
    *) echo "verify: finance-$svc sur $got, attendu $want" >&2; exit 1 ;;
  esac
  kubectl -n preprod rollout status "deploy/finance-$svc" --timeout=5s >/dev/null ||
    { echo "verify: rollout de finance-$svc en cours" >&2; exit 1; }
done
