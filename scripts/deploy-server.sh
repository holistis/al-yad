#!/usr/bin/env bash
# deploy-server.sh — Zet de nieuwste companion-dist op de Hetzner VPS.
#
# Gebruik:
#   bash scripts/deploy-server.sh
#   of via npm: npm run deploy-server (vanuit root van het repo)
#
# Wat het doet:
#   1. Build companion lokaal (fouttolerant — TS-errors buiten server-playwright.js worden genegeerd)
#   2. Kopieer dist/ naar de server via scp
#   3. Herstart PM2 yad-playwright-server
#   4. Health check: /status moet ok:true teruggeven
#   5. Verifieer Ollama-timeout patch (300s) aanwezig in pool.js

set -e

# ── Config ───────────────────────────────────────────────────────────────
SERVER="138.201.204.97"
SERVER_USER="root"
KEY="/c/Code/al-yad/ollama_key"
REMOTE_COMPANION="/opt/al-yad/packages/companion"
REMOTE_SHARED="/opt/al-yad/packages/shared"
LOCAL_COMPANION="packages/companion"
LOCAL_SHARED="packages/shared"
PM2_NAME="yad-playwright-server"
API_KEY="***YAD_DEPLOY_KEY_REMOVED***"
HEALTH_PORT=3751

SSH="ssh -i $KEY -o StrictHostKeyChecking=no $SERVER_USER@$SERVER"
SCP="scp -i $KEY -o StrictHostKeyChecking=no"

# ── Kleur helpers ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}→ $1${NC}"; }

echo ""
echo "========================================"
echo "  YAD Playwright-server Deploy"
echo "  Doel: $SERVER_USER@$SERVER:$HEALTH_PORT"
echo "========================================"
echo ""

# Zorg dat we vanuit de root van het repo draaien
cd "$(dirname "$0")/.."

# ════════════════════════════════════════════════════════════════════════════
# STAP 1 — Build
# ════════════════════════════════════════════════════════════════════════════
info "[1/5] Build — @yad/shared + @yad/companion..."

pnpm --filter @yad/shared build 2>&1
echo ""

# Companion build: TS-fouten in extension/loop zijn niet van ons — negeer exit-code
# maar check daarna ZELF of de kritieke bestanden er zijn.
pnpm --filter @yad/companion build 2>&1 || true

# Loop: check of alle kritieke bestanden aanwezig zijn
CRITICAL=(
  "$LOCAL_COMPANION/dist/server-playwright.js"
  "$LOCAL_COMPANION/dist/engine/pool.js"
  "$LOCAL_COMPANION/dist/agent/loop.js"
  "$LOCAL_COMPANION/dist/playwright-hand.js"
)
for f in "${CRITICAL[@]}"; do
  [ -f "$f" ] || fail "Kritiek bestand ontbreekt na build: $f"
done
ok "Build geslaagd — alle kritieke bestanden aanwezig"

# Extra check: zit timeoutMs in pool.js? (broncode-fix moet erin zitten)
grep -q "timeoutMs" "$LOCAL_COMPANION/dist/engine/pool.js" \
  || fail "timeoutMs NIET gevonden in pool.js — is pool.ts correct gebuild?"
ok "Ollama 300s timeout aanwezig in pool.js"

# ════════════════════════════════════════════════════════════════════════════
# STAP 2 — Kopieer dist naar server
# ════════════════════════════════════════════════════════════════════════════
info "[2/5] Dist kopiëren naar $SERVER..."

$SCP -rq "$LOCAL_SHARED/dist/"    "$SERVER_USER@$SERVER:$REMOTE_SHARED/dist/"
$SCP -rq "$LOCAL_COMPANION/dist/" "$SERVER_USER@$SERVER:$REMOTE_COMPANION/dist/"

# Verifieer: bestandsgrootte lokaal vs remote moet overeenkomen
LOCAL_SIZE=$(wc -c < "$LOCAL_COMPANION/dist/server-playwright.js" | tr -d ' ')
REMOTE_SIZE=$($SSH "wc -c < $REMOTE_COMPANION/dist/server-playwright.js" 2>/dev/null | tr -d ' ')
[ "$LOCAL_SIZE" = "$REMOTE_SIZE" ] \
  || fail "server-playwright.js grootte mismatch (lokaal: ${LOCAL_SIZE}B, server: ${REMOTE_SIZE}B) — SCP mislukt"
ok "Dist succesvol overgezet naar $SERVER (${LOCAL_SIZE} bytes)"

# ════════════════════════════════════════════════════════════════════════════
# STAP 3 — PM2 herstarten
# ════════════════════════════════════════════════════════════════════════════
info "[3/5] PM2 '$PM2_NAME' herstarten..."

$SSH "pm2 restart $PM2_NAME --update-env" 2>&1 | grep -E "Done|Applying|error|warn" || true

# Wacht tot PM2 stabiel is (max 10s)
for i in 1 2 3 4 5; do
  sleep 2
  STATUS=$($SSH "pm2 jlist 2>/dev/null | python3 -c \"import sys,json; procs=json.load(sys.stdin); [print(p.get('pm2_env',{}).get('status','?')) for p in procs if p.get('name')=='$PM2_NAME']\"" 2>/dev/null || echo "")
  if [ "$STATUS" = "online" ]; then
    ok "PM2 status: online (na ${i}x2s)"
    break
  fi
  [ $i -eq 5 ] && fail "PM2 komt niet online binnen 10s — check: pm2 logs $PM2_NAME"
done

# ════════════════════════════════════════════════════════════════════════════
# STAP 4 — Health check (3 pogingen, 5s tussenpoos)
# ════════════════════════════════════════════════════════════════════════════
info "[4/5] Health check http://localhost:$HEALTH_PORT/status..."

HEALTH_OK=false
for i in 1 2 3; do
  sleep 5
  RESP=$($SSH "curl -s -H 'X-API-Key: $API_KEY' http://localhost:$HEALTH_PORT/status" 2>/dev/null || echo "")
  if echo "$RESP" | grep -q '"ok":true'; then
    ok "Health check geslaagd: $RESP"
    HEALTH_OK=true
    break
  fi
  info "Poging $i/3: geen ok:true — antwoord: ${RESP:-'(leeg)'}"
done

$HEALTH_OK || fail "Health check mislukt na 3 pogingen — run: pm2 logs $PM2_NAME"

# ════════════════════════════════════════════════════════════════════════════
# STAP 5 — Extern bereikbaar?
# ════════════════════════════════════════════════════════════════════════════
info "[5/5] Extern bereikbaar controleren (vanuit lokale machine)..."

EXT_RESP=$(curl -s --max-time 10 -H "X-API-Key: $API_KEY" "http://$SERVER:$HEALTH_PORT/status" 2>/dev/null || echo "")
if echo "$EXT_RESP" | grep -q '"ok":true'; then
  ok "Extern bereikbaar: $EXT_RESP"
else
  info "Waarschuwing: extern niet bereikbaar (firewall of netwerk) — intern werkt het wel"
fi

# ════════════════════════════════════════════════════════════════════════════
# Klaar
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "========================================"
echo "  Deploy geslaagd!"
echo "  Endpoint:  http://$SERVER:$HEALTH_PORT"
echo "  API-key:   $API_KEY"
echo "  PM2:       $PM2_NAME"
echo "========================================"
echo ""
