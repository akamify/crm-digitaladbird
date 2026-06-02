#!/usr/bin/env bash
# Diagnose "Internal Server Error" on login.
# Run ON THE VPS. Prints the actual backend error so we can fix it precisely.
#
# Usage:
#   bash scripts/diagnose-login.sh                         # uses production URL
#   PUBLIC_URL=http://127.0.0.1:4000 bash scripts/diagnose-login.sh
#   ADMIN_EMAIL=you@x.com ADMIN_PASS=... bash scripts/diagnose-login.sh

set -uo pipefail
cd "$(dirname "$0")/.."

PUBLIC_URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"
hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
grn() { printf "\033[32m%s\033[0m\n" "$*"; }

hdr "1. Backend process status"
pm2 list | grep -E "crm-backend|crm-frontend" || red "PM2 not running these processes"
echo
pm2 show crm-backend 2>/dev/null | grep -E "status|uptime|restarts|exec mode|node version|created at|TZ"

hdr "2. Last 80 lines of crm-backend log (errors first)"
pm2 logs crm-backend --nostream --lines 200 2>/dev/null | grep -iE "error|throw|reject|stack|crash" | tail -40 || echo "(no error lines)"
echo
echo "--- last 25 lines verbatim ---"
pm2 logs crm-backend --nostream --lines 25 2>/dev/null

hdr "3. Currently-running commit on disk"
git log -1 --oneline
echo
echo "Migrations table (latest 5):"
DBURL=$(grep -E '^DATABASE_URL=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
psql -A -t "$DBURL" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5" 2>&1 | head -10
echo
echo "DB session timezone (what NEW connections see):"
psql -A -t "$DBURL" -c "SELECT current_setting('TimeZone'), now()" 2>&1 | head -3

hdr "4. Probe POST /api/auth/login with garbage to surface the error"
# A 400 with structured error code = backend is healthy, just bad input
# A 500 with HTML = nginx returning gateway error (backend down or crashed mid-request)
# A 500 with JSON  = backend running but blew up inside the handler
echo "Probing $PUBLIC_URL/api/auth/login with empty body..."
curl -s -i -X POST "$PUBLIC_URL/api/auth/login" \
     -H "Content-Type: application/json" -d '{}' | head -25
echo

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASS:-}" ]; then
  echo "Probing with real credentials ($ADMIN_EMAIL)..."
  curl -s -i -X POST "$PUBLIC_URL/api/auth/login" \
       -H "Content-Type: application/json" \
       -d "{\"identifier\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | head -30
else
  echo "(set ADMIN_EMAIL + ADMIN_PASS to also probe with real credentials)"
fi

hdr "5. Direct hit to backend on :4000 (bypasses Nginx)"
curl -s -i -X POST "http://127.0.0.1:4000/api/auth/login" \
     -H "Content-Type: application/json" -d '{}' | head -10
echo
echo "If this returns 400/401 but $PUBLIC_URL returns 500 → Nginx config bug."
echo "If this also returns 500 → backend crash. Check section 2 logs."

hdr "6. Nginx error log (last 20 lines)"
if [ -r /var/log/nginx/error.log ]; then
  tail -20 /var/log/nginx/error.log
else
  echo "(cannot read /var/log/nginx/error.log — try: sudo tail /var/log/nginx/error.log)"
fi

hdr "7. Sanity probe — health endpoints"
for p in /health /health/db; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL$p")
  printf "  GET %-15s HTTP:%s\n" "$p" "$code"
done

hdr "VERDICT"
echo "Paste sections 2 and 4 back to Claude. The actual stack trace from"
echo "section 2 (backend error log) tells us exactly what broke."
