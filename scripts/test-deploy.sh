#!/usr/bin/env bash
# Teste scripts/deploy.sh hors ligne : un dépôt applicatif jetable, un
# developpeur-gitops jetable (avec un dépôt nu comme remote) et un faux `gh`
# qui sert une liste de runs CI depuis un fichier JSON (filtres --jq appliqués
# par le vrai jq). Rien ne touche GitHub, GHCR ni le cluster.
#
# Cas couverts :
#   1. L46 — vécu warhammer 01-10 : un commit backend A est poussé, puis un
#      commit B qui ne touche que le plan. Le run de B (vide) finit avant celui
#      de A : la livraison de B doit ATTENDRE le run de A et livrer son image,
#      pas conclure « rien à livrer ».
#   2. Aucun run en cours : comportement inchangé (bump sur le dernier ancêtre
#      construit, puis « rien à livrer » si les tags sont déjà à jour).
#   3. Run d'ancêtre qui ne finit jamais : échec borné, aucun commit gitops.
#   4. Un run en cours sur un sha qui n'est PAS un ancêtre est ignoré.
set -euo pipefail

DEPLOY="$(cd "$(dirname "$0")" && pwd)/deploy.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

# --- faux gh --------------------------------------------------------------
# $FAKE_GH/runs.json : [{databaseId, headSha, status, conclusion, jobs:[{name, conclusion}]}]
# $FAKE_GH/runs-final.json (facultatif) : remplace runs.json au N-ième
# `gh run list` (N = contenu de $FAKE_GH/finish-after) — la CI qui finit.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
d="$FAKE_GH"
[ "$1 $2" = "run list" ] || [ "$1 $2" = "run view" ] || { echo "faux gh: $*" >&2; exit 2; }
cmd="$2"; shift 2
id="" status="" filter="."
[ "$cmd" = view ] && { id="$1"; shift; }
while [ $# -gt 0 ]; do
  case "$1" in
    --status) status="$2"; shift 2 ;;
    --jq) filter="$2"; shift 2 ;;
    --workflow|--limit|--json) shift 2 ;;
    *) echo "faux gh: option $1" >&2; exit 2 ;;
  esac
done
if [ "$cmd" = view ] && [ "$(cat "$d/fail-view" 2>/dev/null)" = "$id" ]; then
  echo "HTTP 502: Bad Gateway (faux gh)" >&2; exit 1
fi
if [ "$cmd" = list ]; then
  n=$(( $(cat "$d/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/calls"
  if [ -f "$d/finish-after" ] && [ "$n" -ge "$(cat "$d/finish-after")" ]; then
    cp "$d/runs-final.json" "$d/runs.json"
  fi
  if [ "$status" = success ]; then
    jq -r "[.[] | select(.status == \"completed\" and .conclusion == \"success\")] | $filter" "$d/runs.json"
  else
    jq -r "$filter" "$d/runs.json"
  fi
else
  jq -r ".[] | select(.databaseId == $id) | $filter" "$d/runs.json"
fi
EOF
chmod +x "$TMP/bin/gh"

run_json() { # id sha status conclusion services… (le run et ses jobs de build ont la même conclusion)
  local id=$1 sha=$2 st=$3 concl=$4; shift 4
  local jobs='[{"name":"Detect changed services","conclusion":"success"}'
  for s in "$@"; do jobs="$jobs,{\"name\":\"Build & push $s\",\"conclusion\":\"$concl\"}"; done
  printf '{"databaseId":%s,"headSha":"%s","status":"%s","conclusion":"%s","url":"https://ci/runs/%s","jobs":%s]}' \
    "$id" "$sha" "$st" "$concl" "$id" "$jobs"
}

# --- dépôts jetables -------------------------------------------------------
# app : C0 (backend+frontend) → A (backend) → B (plan seul) ; X = branche sœur de A.
setup() {
  local w="$TMP/$1"
  mkdir -p "$w"
  git init -q "$w/app"
  (
    cd "$w/app"
    git config user.email t@t; git config user.name t
    mkdir -p backend frontend docs/plan
    echo 0 > backend/a; echo 0 > frontend/a; git add .; git commit -qm C0
    echo 1 > backend/a; git commit -qam A
    git checkout -qb sœur HEAD~1; echo x > backend/a; git commit -qam X; git checkout -q -
    echo plan > docs/plan/raf.yaml; git add docs; git commit -qm "chore(L9): plan"
  )
  C0=$(git -C "$w/app" rev-parse HEAD~2); A=$(git -C "$w/app" rev-parse HEAD~1)
  B=$(git -C "$w/app" rev-parse HEAD); X=$(git -C "$w/app" rev-parse sœur)
  git init -q --bare "$w/remote.git"
  git clone -q "$w/remote.git" "$w/gitops" 2>/dev/null
  (
    cd "$w/gitops"
    git config user.email t@t; git config user.name t
    mkdir -p charts/finance-tracker
    printf 'backend:\n  image: b\n  tag: sha-%s\nfrontend:\n  image: f\n  tag: sha-%s\n' \
      "${C0:0:7}" "${C0:0:7}" > charts/finance-tracker/values.yaml
    git add .; git commit -qm init; git push -q origin HEAD 2>/dev/null
  )
  mkdir -p "$w/gh"
  W="$w"
}

deploy() { # lance deploy.sh pour B ; sortie dans $W/out, code dans $code
  code=0
  (cd "$W/app" && PATH="$TMP/bin:$PATH" FAKE_GH="$W/gh" GITOPS_DIR="$W/gitops" \
    CADENCE_SHA="$B" CADENCE_SHORT="${B:0:7}" DEPLOY_CI_POLL=0 DEPLOY_CI_TIMEOUT="${TIMEOUT:-5}" \
    sh "$DEPLOY") > "$W/out" 2>&1 || code=$?
}

tag() { sed -n "/^$1:/,/^[a-z]/ s/^  tag: sha-//p" "$W/gitops/charts/finance-tracker/values.yaml"; }

check() { # libellé condition…
  local label=$1; shift
  if "$@"; then echo "ok   $label"; else echo "FAIL $label"; sed 's/^/     | /' "$W/out"; fails=$((fails + 1)); fi
}

# 1. Vécu warhammer 01-10 : run de A en cours, run de B (vide) déjà fini.
setup cas1
{ echo "["; run_json 3 "$B" completed success; echo ","; run_json 2 "$A" in_progress "" backend
  echo ","; run_json 1 "$C0" completed success backend frontend; echo "]"; } > "$W/gh/runs.json"
{ echo "["; run_json 3 "$B" completed success; echo ","; run_json 2 "$A" completed success backend
  echo ","; run_json 1 "$C0" completed success backend frontend; echo "]"; } > "$W/gh/runs-final.json"
echo 3 > "$W/gh/finish-after"
deploy
check "1. attend le run en cours de l'ancêtre A (exit 0)" test "$code" -eq 0
check "1. backend livré sur l'image de A" test "$(tag backend)" = "${A:0:7}"
check "1. frontend inchangé" test "$(tag frontend)" = "${C0:0:7}"
check "1. commit gitops poussé" test "$(git -C "$W/gitops" rev-parse HEAD)" = "$(git -C "$W/remote.git" rev-parse HEAD)"
check "1. l'attente est annoncée" grep -q "attente" "$W/out"

# 2. Aucun run en cours : comportement d'avant L46.
setup cas2
{ echo "["; run_json 3 "$B" completed success; echo ","; run_json 2 "$A" completed success backend
  echo ","; run_json 1 "$C0" completed success backend frontend; echo "]"; } > "$W/gh/runs.json"
deploy
check "2. sans run en cours : backend livré sur A" test "$code" -eq 0 -a "$(tag backend)" = "${A:0:7}"
check "2. sans run en cours : pas d'attente" bash -c "! grep -q attente '$W/out'"
deploy
check "2. relancé : rien à livrer" grep -q "rien à livrer" "$W/out"

# 3. Run d'ancêtre bloqué : échec borné, gitops intact.
setup cas3
{ echo "["; run_json 3 "$B" completed success; echo ","; run_json 2 "$A" queued "" backend
  echo ","; run_json 1 "$C0" completed success backend frontend; echo "]"; } > "$W/gh/runs.json"
before=$(git -C "$W/gitops" rev-parse HEAD)
TIMEOUT=1 deploy
check "3. run bloqué : échec (exit ≠ 0)" test "$code" -ne 0
check "3. run bloqué : message explicite" grep -q "toujours en cours" "$W/out"
check "3. run bloqué : aucun commit gitops" test "$(git -C "$W/gitops" rev-parse HEAD)" = "$before"

# 4. Run en cours d'un sha qui n'est pas un ancêtre de B : ignoré.
setup cas4
{ echo "["; run_json 4 "$X" in_progress "" backend; echo ","; run_json 3 "$B" completed success
  echo ","; run_json 2 "$A" completed success backend
  echo ","; run_json 1 "$C0" completed success backend frontend; echo "]"; } > "$W/gh/runs.json"
TIMEOUT=1 deploy
check "4. run hors ascendance ignoré : livré sans attendre" test "$code" -eq 0 -a "$(tag backend)" = "${A:0:7}"

[ "$fails" -eq 0 ] && echo "test-deploy : tout est vert" || { echo "test-deploy : $fails échec(s)"; exit 1; }
