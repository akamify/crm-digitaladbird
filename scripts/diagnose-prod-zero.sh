#!/usr/bin/env bash
# Why does prod dashboard show 0 leads when DB has 1600+?
# Run ON THE VPS. Prints the actual number returned at every layer so we
# can see exactly where 1600 becomes 0. No guessing.
#
# Usage:
#   ssh root@<vps>
#   cd /var/www/crm
#   bash scripts/diagnose-prod-zero.sh
#
# Prints (in order):
#   1. Which commit is actually running
#   2. Which DATABASE_URL backend is connected to (host + db name, NOT password)
#   3. Raw COUNT(*) from leads in that DB
#   4. What backend's /health/db-strict says (real_pg + users count)
#   5. What backend returns to admin JWT at /api/admin/live-stats and /reports/summary
#   6. What PM2 says about the process
#   7. Nginx routing for /api → which upstream
#   8. Browser cache headers on /api/admin/live-stats
#
# At the bottom: a 1-line VERDICT mapping the symptom to the cause.

set -uo pipefail
cd "$(dirname "$0")/.."

hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
red()  { printf "\033[31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[32m%s\033[0m\n" "$*"; }
amber(){ printf "\033[33m%s\033[0m\n" "$*"; }

# ============================================================
hdr "1. Running commit"
# ============================================================
echo "Working tree HEAD:"
git log -1 --oneline 2>/dev/null
echo
echo "PM2 process started from this directory? (pwd field):"
pm2 show crm-backend 2>/dev/null | grep -E "^│ (script path|exec cwd|node version|pid|status|restarts|uptime)" | head -10 || echo "  (pm2 not running crm-backend)"

# ============================================================
hdr "2. backend/.env — which database is configured?"
# ============================================================
if [ ! -f backend/.env ]; then
  red "backend/.env MISSING — backend is running with no env config (or env was sourced some other way)"
else
  DBURL=$(grep -E '^DATABASE_URL=' backend/.env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  # Strip password before printing
  SAFE_DBURL=$(echo "$DBURL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')
  echo "DATABASE_URL = $SAFE_DBURL"
  if [ -z "$DBURL" ]; then
    red "DATABASE_URL is empty in backend/.env"
  fi
fi
echo
echo "Other env vars present:"
grep -cE '^(JWT_ACCESS_SECRET|META_APP_SECRET|META_APP_ID|META_VERIFY_TOKEN)=' backend/.env 2>/dev/null \
  | awk '{print "  count = " $1 " / 4 expected"}'

# ============================================================
hdr "3. Raw COUNT(*) from the DB the .env points to"
# ============================================================
if [ -n "${DBURL:-}" ]; then
  echo "Connecting to $SAFE_DBURL ..."
  psql "$DBURL" -A -t -c "
    SELECT
      'users (not deleted)    : ' || COUNT(*)::text FROM users WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'leads (not deleted)    : ' || COUNT(*)::text FROM leads WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'leads.source=meta      : ' || COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND source='meta'
    UNION ALL
    SELECT 'today_IST              : ' || COUNT(*)::text FROM leads WHERE deleted_at IS NULL
       AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    UNION ALL
    SELECT 'unassigned in queue    : ' || COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL
    UNION ALL
    SELECT 'meta_pages active      : ' || COUNT(*)::text FROM meta_pages WHERE is_active=TRUE
    UNION ALL
    SELECT 'integration_configs    : ' || COUNT(*)::text FROM integration_configs
    UNION ALL
    SELECT 'DB name                : ' || current_database()
    UNION ALL
    SELECT 'DB session timezone    : ' || current_setting('TimeZone')
    UNION ALL
    SELECT 'now() in DB tz         : ' || now()::text
    ;
  " 2>&1 | sed 's/^/  /'
else
  amber "Skipping DB COUNT — no DATABASE_URL"
fi

# ============================================================
hdr "4. What backend's own DB probe says"
# ============================================================
PUB="${PUBLIC_URL:-https://crm.digitaladbird.com}"
echo "Probing $PUB/health/db-strict ..."
curl -s "$PUB/health/db-strict" | head -c 400; echo

# ============================================================
hdr "5. What backend returns to an ADMIN JWT"
# ============================================================
# Mint a JWT against the same DB the backend uses, using the same secret.
JWT=$(cd backend && node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: [u] } = await c.query(\"SELECT id, role, full_name FROM users WHERE role='super_admin' AND deleted_at IS NULL LIMIT 1\");
  await c.end();
  if (!u) { console.error('NO_ADMIN_USER'); process.exit(1); }
  console.log(jwt.sign(
    { sub: u.id, role: u.role, name: u.full_name },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '5m', issuer: 'digitaladbird-crm' },
  ));
  console.error('admin=' + u.full_name);
})();
" 2>&1)

# split JWT (stdout) from admin name (stderr)
ADMIN_LINE=$(echo "$JWT" | grep '^admin=')
JWT=$(echo "$JWT" | grep -v '^admin=' | tail -1)
echo "  $ADMIN_LINE"

if [ -z "$JWT" ] || [ "$JWT" = "NO_ADMIN_USER" ]; then
  red "  Could not mint admin JWT — check JWT_ACCESS_SECRET and that a super_admin user exists in the DB"
else
  for ep in /api/admin/live-stats /api/reports/summary "/api/admin/leads/fresh?scope=today" /api/distribution/stats; do
    code=$(curl -s -o /tmp/r -w "%{http_code}" -H "Authorization: Bearer $JWT" "$PUB$ep")
    body=$(cat /tmp/r 2>/dev/null | head -c 300)
    echo
    echo "  GET $ep"
    echo "    HTTP $code"
    echo "    body: $body"
    # Pull total_leads / today_leads / total etc from JSON
    echo "$body" | grep -oE '"total_leads":[0-9]+|"today_leads":[0-9]+|"total":[0-9]+|"queued_leads":[0-9]+|"today_received":[0-9]+|"today_total":[0-9]+' | sed 's/^/    -> /' | head -8
  done
fi

# ============================================================
hdr "6. Same endpoints called against 127.0.0.1:4000 directly (bypasses Nginx)"
# ============================================================
if [ -n "${JWT:-}" ] && [ "$JWT" != "NO_ADMIN_USER" ]; then
  for ep in /api/admin/live-stats /api/reports/summary; do
    code=$(curl -s -o /tmp/r -w "%{http_code}" -H "Authorization: Bearer $JWT" "http://127.0.0.1:4000$ep")
    body=$(cat /tmp/r 2>/dev/null | head -c 300)
    echo "  $ep via 127.0.0.1:4000 → HTTP $code"
    echo "  body: $body"
    echo
  done
fi

# ============================================================
hdr "7. PM2 process state + recent error log"
# ============================================================
pm2 list 2>/dev/null | grep -E "name|crm-backend|crm-frontend"
echo
echo "Last 20 lines of crm-backend log (errors filtered):"
pm2 logs crm-backend --nostream --lines 200 2>/dev/null | grep -iE "error|throw|reject|relation .* does not exist|ECONN|fatal|Unhandled" | tail -20 || echo "  (no recent error lines)"

# ============================================================
hdr "8. Cache headers"
# ============================================================
if [ -n "${JWT:-}" ] && [ "$JWT" != "NO_ADMIN_USER" ]; then
  curl -s -D - -o /dev/null -H "Authorization: Bearer $JWT" "$PUB/api/admin/live-stats" \
    | grep -iE "x-cache|cache-control|date|content-length" | sed 's/^/  /'
fi

# ============================================================
hdr "VERDICT — match symptom to cause"
# ============================================================
cat <<'EOF'

Look at the four numbers we just printed:

  A) Section 3 "leads (not deleted)" ............ raw DB count
  B) Section 4 /health/db-strict "users" ........ what backend sees in DB
  C) Section 5 /api/admin/live-stats "total_leads" .. what dashboard receives
  D) Section 6 same endpoint via 127.0.0.1:4000 ..... what backend returns
                                                       (bypasses Nginx + browser cache)

   A != B  → backend env points to a DIFFERENT database than your shell
            → fix: backend/.env DATABASE_URL is wrong; the .env you read in
              section 2 is not the one PM2 loaded. Check pm2 env vars
              (`pm2 show crm-backend | grep -i env`) and the actual file
              path PM2 read at start.

   B != D  → backend connected to right DB but API hits a different one
            → impossible normally; would mean two pools. Unlikely.

   D > 0 but C = 0 → Nginx is routing /api elsewhere (old upstream / wrong
            server block / a CDN in front returning a cached zero-state).
            → fix: `sudo nginx -T | grep -B2 'proxy_pass'` and confirm
              /api → http://127.0.0.1:4000.

   C = D = 0 but A > 0 → JWT belongs to a user with no visible data
            → if the admin user used to mint JWT is NOT super_admin, or
              their role is scoped (RM = team only, partner = self),
              they'd see 0. Confirm Section 5 line "admin=..." is your
              actual super_admin.

   All four = 0 → DB really is empty in the connected database
            → confirms wrong-DB hypothesis from `A != B` test.

Paste the entire output of this script back to Claude.
The combination of A / B / C / D tells the whole story.
EOF
