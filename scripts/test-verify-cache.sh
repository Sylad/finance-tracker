#!/usr/bin/env bash
# Teste la sonde Range de scripts/verify-cache.sh (L165) hors ligne, sans Docker :
# un faux serveur HTTP (python3) rejoue ce que renvoient l'origine et Cloudflare.
#
# Cas : 200 entier (origine) · 206 puis 416 servis par le cache Cloudflare
# (HIT) = vert · 416 sur la plage hors fichier SANS HIT (réponse d'origine, MISS
# ou sans en-tête Cloudflare) = rouge · 416 HIT sur la plage valide = rouge ·
# 206 sans cache long = rouge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'kill $(cat "$TMP"/pid 2>/dev/null) 2>/dev/null || true; rm -rf "$TMP"' EXIT
fails=0

cat > "$TMP/server.py" <<'PY'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
MODE = sys.argv[1]
LONG = "public, max-age=31536000, immutable"
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, ctype, cc, body=b"x", cf=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if cc: self.send_header("Cache-Control", cc)
        if cf: self.send_header("CF-Cache-Status", cf)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        path = self.path.split("?")[0]
        rng = self.headers.get("Range", "")
        if path == "/":
            self.send(200, "text/html", "no-cache", b'<script src="/assets/app-abc12345.js"></script>')
        elif path.startswith("/assets/absent"):
            self.send(404, "text/html", "no-store")
        elif path == "/sw.js":
            self.send(200, "application/javascript", "no-cache")
        elif path.startswith("/assets/") and rng:
            if rng == "bytes=999999999-":
                if MODE == "cf": self.send(416, "text/plain", None, cf="HIT")
                elif MODE == "origin416-miss": self.send(416, "text/plain", LONG, cf="MISS")
                elif MODE == "origin416-nocf": self.send(416, "text/plain", LONG)
                else: self.send(200, "application/javascript", LONG)
            else:
                if MODE == "cf416-valid": self.send(416, "text/plain", None, cf="HIT")
                elif MODE == "nolong": self.send(206, "application/javascript", "public, max-age=60", cf="HIT")
                else: self.send(206 if MODE == "cf" else 200, "application/javascript", LONG, cf="HIT" if MODE == "cf" else None)
        elif path.startswith("/assets/"):
            self.send(200, "application/javascript", LONG)
        else:
            self.send(404, "text/plain", "no-store")
srv = HTTPServer(("127.0.0.1", 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
PY

scenario() { # libellé mode attendu(vert|rouge) [motif-du-message]
  local label=$1 mode=$2 want=$3 msg=${4:-}
  python3 "$TMP/server.py" "$mode" > "$TMP/port" &
  echo $! > "$TMP/pid"
  for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
  local port; port="$(cat "$TMP/port")" rc=0
  VERIFY_BASE_URL="http://127.0.0.1:$port" sh "$ROOT/scripts/verify-cache.sh" > "$TMP/out" 2>&1 || rc=$?
  kill "$(cat "$TMP/pid")" 2>/dev/null || true; wait 2>/dev/null || true
  if [ "$want" = vert ] && [ "$rc" -eq 0 ]; then echo "ok   $label"
  elif [ "$want" = rouge ] && [ "$rc" -ne 0 ] && grep -q -- "$msg" "$TMP/out"; then echo "ok   $label"
  else echo "FAIL $label (code $rc, attendu $want)"; sed 's/^/     | /' "$TMP/out"; fails=$((fails + 1)); fi
}

scenario "origine : 200 entier sur les deux plages" origin vert
scenario "Cloudflare : 206 puis 416 HIT hors fichier toléré" cf vert
scenario "416 hors fichier de l'origine (MISS) refusé" origin416-miss rouge "Range bytes=999999999-"
scenario "416 hors fichier sans en-tête Cloudflare refusé" origin416-nocf rouge "Range bytes=999999999-"
scenario "416 HIT sur la plage valide refusé" cf416-valid rouge "Range bytes=0-9"
scenario "206 sans cache long refusé" nolong rouge "cache long est perdu"

echo
[ "$fails" -eq 0 ] && echo "test-verify-cache : tout est vert" || { echo "test-verify-cache : $fails échec(s)"; exit 1; }
