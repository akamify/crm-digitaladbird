#!/usr/bin/env bash
# One-shot deploy + verify for crm.digitaladbird.com.
# Run this ON THE VPS as the user that owns the repo:
#   bash scripts/deploy-and-verify.sh
#
# It will:
#   1. git pull latest main (fails loudly if HEAD != origin/main)
#   2. backend deps + migrations
#   3. frontend deps + production build with cache reset
#   4. pm2 restart with --update-env
#   5. smoke-test the public HTTPS URL for the SPECIFIC fixes in this rollout
#
# Exit codes:
#   0 = everything verified
#   non-zero = stop and read the failure line above
set -euo pipefail

ROOT="${ROOT:-$(pwd)}"
PUBLIC_URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"   # optional: pass to assert a specific SHA

ok()   { printf "\033[32m✔\033[0m  %s\n" "$*"; }
fail() { printf "\033[31m✘\033[0m  %s\n" "$*"; exit 1; }
hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

cd "$ROOT"
[ -d .git ] || fail "Not a git repo: $ROOT"

hdr "1. Git pull"
git fetch --all --prune
BEFORE=$(git rev-parse HEAD)
git checkout main
git reset --hard origin/main
AFTER=$(git rev-parse HEAD)
ok "HEAD was $BEFORE → now $AFTER"
if [ -n "$EXPECTED_COMMIT" ] && [ "$AFTER" != "$EXPECTED_COMMIT" ]; then
  fail "HEAD ($AFTER) != expected ($EXPECTED_COMMIT). origin/main may not have your commit."
fi
git log -1 --oneline

hdr "2. Backend deps + migrations"
cd "$ROOT/backend"
npm ci --omit=dev || npm install --omit=dev
node src/db/migrate.js || fail "Migrations failed"
ok "Migrations applied"

hdr "3. Frontend cache reset + production build"
cd "$ROOT/frontend"
rm -rf .next .next/cache node_modules/.cache
npm ci || npm install
NEXT_TELEMETRY_DISABLED=1 npm run build || fail "Next build failed"
ok "Next build complete"
[ -d .next/standalone ] && ok ".next/standalone present" || echo "  (no standalone build — using next start)"

hdr "4. PM2 restart (fully reload env)"
# Hard reset PM2 so a cached old process can't survive the rollout.
pm2 delete crm-backend  2>/dev/null || true
pm2 delete crm-frontend 2>/dev/null || true
cd "$ROOT"
pm2 start ecosystem.config.js --update-env || fail "pm2 start failed"
pm2 save
sleep 4
pm2 list

hdr "5. Live smoke against $PUBLIC_URL"

# 5a. Backend up
code=$(curl -s -o /tmp/h.json -w "%{http_code}" "$PUBLIC_URL/health" || echo 000)
[ "$code" = "200" ] || fail "GET $PUBLIC_URL/health returned $code"
ok "GET /health → 200"

# 5b. DB reachable
code=$(curl -s -o /tmp/hdb.json -w "%{http_code}" "$PUBLIC_URL/health/db" || echo 000)
[ "$code" = "200" ] || fail "GET /health/db returned $code"
ok "GET /health/db → 200  $(cat /tmp/hdb.json)"

# 5c. Socket.IO handshake
sio=$(curl -s -o /tmp/sio -w "%{http_code}" "$PUBLIC_URL/socket.io/?EIO=4&transport=polling" || echo 000)
[ "$sio" = "200" ] || fail "Socket.IO handshake returned $sio"
grep -q '"sid"' /tmp/sio || fail "Socket.IO handshake body missing sid"
ok "Socket.IO handshake OK"

# 5d. Frontend root reachable
code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL/")
case "$code" in 200|307) ok "Frontend / → $code" ;; *) fail "Frontend / returned $code" ;; esac

# 5e. Login form served
code=$(curl -s -o /tmp/login.html -w "%{http_code}" "$PUBLIC_URL/login")
[ "$code" = "200" ] || fail "GET /login returned $code"
grep -qi "DigitalADbird\|CRM\|Login\|password" /tmp/login.html || fail "/login HTML doesn't look like the CRM login page"
ok "Login page renders"

# 5f. New routes registered (must be 401, not 404)
for r in \
  "/api/leads/00000000-0000-0000-0000-000000000000/workflow/conversion/attachments" \
  "/api/admin/leads/fresh" \
  "/api/admin/sheets/configs" \
  "/api/workflow/summary"
do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL$r")
  if   [ "$code" = "401" ]; then ok  "$r → 401 (auth-gated, registered)"
  elif [ "$code" = "404" ]; then fail "$r → 404  — backend on VPS is older than this commit"
  else echo "  $r → $code (unexpected but registered)"; fi
done

# 5g. The fix that broke before — confirm built JS does NOT contain the
#     old localStorage.getItem('dab.access') call. Greps the actual built
#     chunks in .next so we know the BROWSER will get the fix.
hdr "5g. Built bundle scan (per-tab session isolation)"
cd "$ROOT/frontend"
if grep -REn "localStorage\.getItem\(['\"]dab\.access['\"]" .next 2>/dev/null | head -3; then
  fail "Built .next bundle still contains localStorage.getItem('dab.access') — stale build"
fi
ok "No legacy localStorage('dab.access') in built bundle"

# 5h. The fix that broke before — confirm the old UH lead-levels are GONE
#     from the built bundle.
if grep -REn "uh_partner|uh_trader" .next 2>/dev/null | head -3; then
  fail "Built bundle still contains uh_partner/uh_trader — stale build or stale source"
fi
ok "No UH lead-levels in built bundle"

# 5i. Migration 029 actually applied
hdr "5i. DB schema check (migration 029)"
cd "$ROOT/backend"
node -e "
const pg = require('pg');
require('dotenv').config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const m = await c.query(\"SELECT count(*)::int n FROM schema_migrations WHERE filename = '029_payment_attachments.sql'\");
  if (m.rows[0].n !== 1) { console.error('FAIL: 029_payment_attachments not applied'); process.exit(1); }
  const t = await c.query(\"SELECT to_regclass('public.lead_payment_attachments') AS x\");
  if (!t.rows[0].x) { console.error('FAIL: lead_payment_attachments table missing'); process.exit(1); }
  console.log('OK: 029 applied, lead_payment_attachments present');
  await c.end();
}).catch(e => { console.error('DB ERR:', e.message); process.exit(1); });
" || fail "DB schema check failed"

hdr "ALL CHECKS PASSED"
echo "Deployed commit:"
git -C "$ROOT" log -1 --oneline
echo
echo "Hard refresh the browser (Ctrl+Shift+R) and clear site data once for"
echo "$PUBLIC_URL so any old localStorage tokens are swept."
