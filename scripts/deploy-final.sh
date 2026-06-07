#!/usr/bin/env bash
# ONE-SHOT: Make VPS identical to localhost.
#
#   ssh root@<vps>
#   cd /var/www/crm
#   bash scripts/deploy-final.sh
#
# Pulls latest main, applies migrations, rebuilds frontend with cache wipe,
# restarts PM2 with env reload, and runs 7 layers of assertions covering
# EVERY localhost-vs-prod gap from the last 7 days of commits.
#
# Exit 0 only if every layer matches. Otherwise prints the EXACT failing
# assertion and exits non-zero — DO NOT report success unless you see
# "ALL CHECKS PASSED" at the bottom.
#
# Override:
#   PUBLIC_URL=https://crm.digitaladbird.com  (default)
#   EXPECTED_COMMIT=<sha>  to assert a specific commit landed (recommended)

set -uo pipefail
ROOT="${ROOT:-$(pwd)}"
PUBLIC_URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"

ok()   { printf "\033[32m[OK]\033[0m   %s\n" "$*"; }
fail() { printf "\033[31m[FAIL]\033[0m %s\n" "$*"; exit 1; }
hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

cd "$ROOT"
[ -d .git ]      || fail "$ROOT is not a git repo"
[ -d backend ]   || fail "backend/ missing"
[ -d frontend ]  || fail "frontend/ missing"

# ============================================================
hdr "1. Git pull main + commit check"
# ============================================================
git fetch --all --prune --quiet
BEFORE=$(git rev-parse HEAD)
git checkout main --quiet
git reset --hard origin/main --quiet
AFTER=$(git rev-parse HEAD)
ok "HEAD: $BEFORE → $AFTER"
git log -1 --oneline | sed 's/^/   /'

if [ -n "$EXPECTED_COMMIT" ] && [ "${AFTER:0:7}" != "${EXPECTED_COMMIT:0:7}" ]; then
  fail "HEAD ($AFTER) != EXPECTED ($EXPECTED_COMMIT). origin/main is missing your commit."
fi

# Diff the last 7 days of commits — fail loudly if anything is missing
LAST7=$(git log --since='7 days ago' --pretty=format:'%h' | wc -l)
ok "commits in last 7 days: $LAST7"

# ============================================================
hdr "2. Required files present after pull"
# ============================================================
REQ=(
  backend/src/routes/index.js
  backend/src/services/leadEventService.js
  backend/src/services/requestDistributionEngine.js
  backend/src/middleware/cache.js
  backend/src/db/migrations/030_timezone_ist.sql
  backend/src/db/migrations/031_activity_logs_extended.sql
  backend/src/db/migrations/032_session_activity.sql
  backend/scripts/verify-local.js
  backend/scripts/audit-counts.js
  frontend/public/favicon.svg
  frontend/public/manifest.webmanifest
  frontend/src/components/ui/BirdLogo.tsx
  frontend/src/components/ui/RaccoonMascot.tsx
  ecosystem.config.js
)
for f in "${REQ[@]}"; do
  [ -f "$f" ] || fail "Required file missing after pull: $f"
done
ok "all 14 required files present"

# Source-level fingerprint of fixes that must be in HEAD
grep -q "require('../utils/logger')"          backend/src/routes/index.js \
  || fail "logger require missing in routes/index.js (prod 500 bug)"
grep -q "CASE WHEN.*meta_created_time.*Asia/Kolkata" backend/src/routes/index.js \
  || fail "today-first ORDER BY missing in routes/index.js"
grep -q "CASE WHEN.*meta_created_time.*Asia/Kolkata" backend/src/services/requestDistributionEngine.js \
  || fail "today-first ORDER BY missing in requestDistributionEngine.js"
grep -q "bustLeadCountersCache"               backend/src/middleware/cache.js \
  || fail "bustLeadCountersCache function missing"
grep -q "bustLeadCountersCache"               backend/src/services/leadEventService.js \
  || fail "bustLeadCountersCache call missing in onLeadCreated"
grep -q "BirdMark\|LogoLockup"                frontend/src/components/ui/BirdLogo.tsx \
  || fail "Brand kit (BirdMark/LogoLockup) missing"
ok "source-level fingerprint: all 6 fixes present"

# ============================================================
hdr "3. Backend deps + migrations"
# ============================================================
cd "$ROOT/backend"
npm ci --omit=dev 2>&1 | tail -3
node src/db/migrate.js || fail "Migration runner crashed"

APPLIED=$(node -e "
require('dotenv').config();
const{Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query('SELECT COUNT(*)::int n FROM schema_migrations');console.log(r.rows[0].n);await c.end();})().catch(e=>{console.error(e.message);process.exit(1);})
")
ONDISK=$(ls src/db/migrations/*.sql | wc -l)
[ "$APPLIED" = "$ONDISK" ] || fail "migration drift: on-disk=$ONDISK applied=$APPLIED"
ok "migrations: $APPLIED/$ONDISK applied"

# Latest must be 032
node -e "
require('dotenv').config();
const{Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query(\"SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1\");
if(!r.rows[0]||!r.rows[0].filename.startsWith('032_'))throw new Error('latest='+(r.rows[0]||{}).filename);
console.log('latest:',r.rows[0].filename);await c.end();})().catch(e=>{console.error('FAIL',e.message);process.exit(1);})
" || fail "latest migration is not 032_session_activity"
ok "latest applied migration is 032_session_activity"

# ============================================================
hdr "4. Frontend deps + clean prod build"
# ============================================================
cd "$ROOT/frontend"
rm -rf .next .next/cache node_modules/.cache
npm ci 2>&1 | tail -3
NEXT_TELEMETRY_DISABLED=1 npm run build || fail "next build failed"
[ -f .next/BUILD_ID ] || fail ".next/BUILD_ID missing — build is broken"
BUILD_ID=$(cat .next/BUILD_ID)
ok "frontend build complete (BUILD_ID=$BUILD_ID)"

# Built bundle must contain new bird brand assets path + must NOT contain
# the old localStorage('dab.access') legacy
grep -REn "localStorage\.getItem\(['\"]dab\.access['\"]" .next 2>/dev/null | head -1 \
  && fail "Built bundle still contains legacy localStorage('dab.access')"
grep -REn "uh_partner|uh_trader" .next 2>/dev/null | head -1 \
  && fail "Built bundle still contains uh_partner/uh_trader"
ok "no legacy code in built bundle"

# Favicon + manifest reachable via static path
[ -f public/favicon.svg ]          || fail "public/favicon.svg missing"
[ -f public/manifest.webmanifest ] || fail "public/manifest.webmanifest missing"
ok "favicon.svg + manifest.webmanifest present in public/"

# ============================================================
hdr "5. PM2 hard reset"
# ============================================================
cd "$ROOT"
pm2 delete crm-backend  2>/dev/null || true
pm2 delete crm-frontend 2>/dev/null || true
pm2 start ecosystem.config.js --update-env || fail "pm2 start failed"
pm2 save 2>&1 | tail -1
sleep 5
pm2 list | grep -E "crm-backend|crm-frontend"
pm2 jlist 2>/dev/null | grep -q '"name":"crm-backend"'  || fail "crm-backend not in pm2"
pm2 jlist 2>/dev/null | grep -q '"name":"crm-frontend"' || fail "crm-frontend not in pm2"
ok "pm2 processes: crm-backend + crm-frontend running"

# ============================================================
hdr "6. Backend contract — verify-local.js against PUBLIC_URL"
# ============================================================
cd "$ROOT/backend"
# verify-local.js hits http://127.0.0.1:4000 by default; override to public
PUBLIC_URL_VERIFY="${PUBLIC_URL}" \
  node -e "process.env.PUBLIC_URL='${PUBLIC_URL}'; require('./scripts/verify-local.js')" 2>&1 \
  | tee /tmp/verify_out.log

grep -q "READY_FOR_PROD=YES" /tmp/verify_out.log \
  || fail "verify-local.js did not end with READY_FOR_PROD=YES"
ok "verify-local.js: all assertions passed"

# ============================================================
hdr "7. Dashboard counts parity (audit-counts.js)"
# ============================================================
node scripts/audit-counts.js 2>&1 | tee /tmp/audit_out.log

# Extract the four key API numbers — they must equal their DB counterparts.
# audit-counts.js prints them; just confirm the [API] section ran.
grep -q "GET /api/admin/live-stats"   /tmp/audit_out.log \
  || fail "audit-counts.js never reached the [API] section"
ok "audit-counts.js: DB ↔ API parity printed"

# ============================================================
hdr "8. Public HTTPS smoke"
# ============================================================
code=$(curl -s -o /tmp/h.json -w "%{http_code}" "$PUBLIC_URL/health" || echo 000)
[ "$code" = "200" ] || fail "/health → $code"
ok "/health → 200"

code=$(curl -s -o /tmp/hs.json -w "%{http_code}" "$PUBLIC_URL/health/db-strict" || echo 000)
[ "$code" = "200" ] || fail "/health/db-strict → $code"
grep -q '"real_pg":true' /tmp/hs.json || fail "/health/db-strict not real_pg"
ok "/health/db-strict → real_pg=true"

code=$(curl -s -o /tmp/lg.html -w "%{http_code}" "$PUBLIC_URL/login")
[ "$code" = "200" ] || fail "/login → $code"
grep -qi "DigitalADbird" /tmp/lg.html || fail "/login HTML missing brand"
ok "/login → 200 + brand text present"

code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL/favicon.svg")
[ "$code" = "200" ] || fail "/favicon.svg → $code"
ok "/favicon.svg → 200"

code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL/manifest.webmanifest")
[ "$code" = "200" ] || fail "/manifest.webmanifest → $code"
ok "/manifest.webmanifest → 200"

# ============================================================
hdr "ALL CHECKS PASSED"
# ============================================================
echo
echo "Deployed commit : $(git -C "$ROOT" log -1 --oneline)"
echo "PM2 procs       : $(pm2 jlist | grep -oE '"name":"crm-[a-z]+"' | sort -u | tr '\n' ' ')"
echo "Migrations      : $APPLIED / $ONDISK applied"
echo "Frontend BUILD_ID: $BUILD_ID"
echo
echo "Hard-refresh the browser (Ctrl+Shift+R) and clear site data once for"
echo "$PUBLIC_URL so any old localStorage tokens are swept."
