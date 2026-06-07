#!/usr/bin/env bash
# ONE COMMAND to sync VPS to local state.
#
# Run on VPS:
#   ssh root@<vps>
#   cd /root/crm-digitaladbird
#   bash scripts/vps-sync-from-local.sh
#
# What it does (in order):
#   1. git pull origin main
#   2. backend deps install
#   3. apply migrations
#   4. apply meta-config-seed.sql (pages + forms + campaigns)
#   5. verify counts in DB
#   6. pm2 restart with --update-env
#   7. probe public URL
#
# Stops on first failure. Prints exact next-action.

set -uo pipefail
ok()   { printf "\033[32m[OK]\033[0m   %s\n" "$*"; }
fail() { printf "\033[31m[FAIL]\033[0m %s\n" "$*"; exit 1; }
warn() { printf "\033[33m[WARN]\033[0m %s\n" "$*"; }
hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

ROOT="${ROOT:-$(pwd)}"
cd "$ROOT"

[ -d .git ] || fail "$ROOT is not a git repo. Did you cd to /root/crm-digitaladbird?"

hdr "1. Pull latest from origin/main"
git fetch origin --prune --quiet
BEFORE=$(git rev-parse HEAD)
git checkout main --quiet 2>/dev/null || git checkout master --quiet 2>/dev/null
git merge --ff-only origin/main 2>&1 || fail "git merge failed — check 'git status', maybe local diverged"
AFTER=$(git rev-parse HEAD)
ok "HEAD: ${BEFORE:0:7} → ${AFTER:0:7}"
git log -1 --oneline

hdr "2. Required files present"
[ -f backend/src/db/seeds/meta-config-seed.sql ] || fail "seed file missing — git pull didn't include it"
[ -f backend/scripts/verify-local.js ]            || warn "verify-local.js missing"
[ -f backend/scripts/audit-counts.js ]            || warn "audit-counts.js missing"
ok "seed file present ($(wc -l < backend/src/db/seeds/meta-config-seed.sql) lines)"

hdr "3. Backend deps + migrations"
cd "$ROOT/backend"
npm ci --omit=dev 2>&1 | tail -3
node src/db/migrate.js || fail "migrations failed"
ok "migrations applied"

hdr "4. Apply Meta config seed (pages + forms + campaigns)"
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$DBURL" ] || fail "DATABASE_URL empty in backend/.env"

psql "$DBURL" -f src/db/seeds/meta-config-seed.sql 2>&1 | tail -10 || fail "seed apply failed"
ok "seed applied"

hdr "5. Verify counts in DB"
psql "$DBURL" -A -F'|' -c "
  SELECT 'meta_pages' AS t, COUNT(*)::int FROM meta_pages
  UNION ALL SELECT 'meta_forms',     COUNT(*) FROM meta_forms
  UNION ALL SELECT 'meta_campaigns', COUNT(*) FROM meta_campaigns
  UNION ALL SELECT 'distribution_settings', COUNT(*) FROM distribution_settings
  UNION ALL SELECT 'distribution_rules',    COUNT(*) FROM distribution_rules
  UNION ALL SELECT 'leads (active)',        COUNT(*) FROM leads WHERE deleted_at IS NULL
" 2>&1 | sed 's/^/  /'

hdr "6. Google credentials file present?"
if [ -f backend/credentials/google-service-account.json ] 2>/dev/null \
   || [ -f credentials/google-service-account.json ] 2>/dev/null; then
  ok "google-service-account.json present"
else
  warn "google-service-account.json MISSING — Google Sheets sync will fail"
  warn "From your local PC run:"
  warn "  scp C:/Users/vinit/crm/backend/credentials/google-service-account.json \\"
  warn "      root@$(hostname -I 2>/dev/null | awk '{print $1}'):$ROOT/backend/credentials/"
fi

hdr "7. Restart PM2 backend"
cd "$ROOT"
pm2 restart digital-adbird-crm-backend --update-env || fail "pm2 restart failed"
sleep 5
pm2 list | grep -E "crm|adbird" | sed 's/^/  /'
ok "pm2 restarted"

hdr "8. Public URL smoke test"
URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"
code=$(curl -s -o /tmp/h.json -w "%{http_code}" "$URL/health" || echo 000)
[ "$code" = "200" ] && ok "$URL/health → 200" || warn "$URL/health → $code"

hdr "DONE — what to do next in browser"
cat <<'EOF'

  Open: https://crm.digitaladbird.com/settings
  1. Hard-refresh (Ctrl+Shift+R)
  2. Meta Pages tab → 6 pages should appear (Digital Ad, Digital Ad Bird, etc.)
  3. On each ACTIVE page → "Update Token" → paste a NEW System User token
     (Meta Business Suite → Settings → Users → System Users → Generate Token,
      expiration = "Never")
  4. After tokens added, run on VPS:
       cd backend && BACKFILL_DAYS=7 node scripts/recover-meta-leads.js
     This will pull 1622 leads from Meta directly into VPS DB.

  If you don't see 6 pages, paste the output of section 5 back to Claude.

EOF
