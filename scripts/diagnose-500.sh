#!/usr/bin/env bash
# Production 500-error triage. Run ON THE VPS.
# Surfaces the ACTUAL stack traces behind "Internal Server Error".
#
# Usage:
#   bash scripts/diagnose-500.sh            # last 1000 log lines
#   LINES=5000 bash scripts/diagnose-500.sh # deeper scan

set -uo pipefail
cd "$(dirname "$0")/.."

LINES="${LINES:-1000}"

hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
grn() { printf "\033[32m%s\033[0m\n" "$*"; }

hdr "1. Process state — is anything restarting / OOMing?"
pm2 list 2>/dev/null | grep -E "name|crm-" || red "pm2 not running"
echo
pm2 show crm-backend 2>/dev/null | grep -E "status|uptime|restarts|↺|memory|cpu" || true

hdr "2. Unhandled errors in the last $LINES lines of pm2 log"
# Pino emits one JSON-ish line per error with msg, stack, path, method.
pm2 logs crm-backend --nostream --lines "$LINES" 2>/dev/null \
  | grep -iE "Unhandled error|fatal|TypeError|ReferenceError|relation .* does not exist|ENOTFOUND|ECONNREFUSED|invalid input syntax|null value in column|deadlock|out of memory|JavaScript heap out of memory" \
  | head -40 || echo "(none — that's good)"

hdr "3. HTTP 500/502/504 responses (from morgan access log)"
pm2 logs crm-backend --nostream --lines "$LINES" 2>/dev/null \
  | grep -E " 50[024] [0-9]+ - " \
  | awk '{
      method=$0
      # Extract: "METHOD PATH status"
      match($0, /"([A-Z]+) ([^"]+)"/, m)
      match($0, /" ([0-9]{3}) /, s)
      if (m[1] && s[1]) print s[1]" "m[1]" "m[2]
    }' \
  | sort | uniq -c | sort -rn | head -20

hdr "4. Most-frequent error MESSAGES (deduped)"
pm2 logs crm-backend --nostream --lines "$LINES" 2>/dev/null \
  | grep -oP '"msg":"[^"]+(?:relation [^"]+|ECONN[A-Z]+|null value [^"]+|duplicate key [^"]+|TypeError[^"]+|ReferenceError[^"]+)' \
  | sort | uniq -c | sort -rn | head -15

hdr "5. Slow queries (statement_timeout fires)"
pm2 logs crm-backend --nostream --lines "$LINES" 2>/dev/null \
  | grep -iE "Query timeout|statement timeout|57014" | head -10

hdr "6. PG pool health (current connection count + idle)"
DBURL=$(grep -E '^DATABASE_URL=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
psql -A -t "$DBURL" -c "
SELECT
  'total:'   || count(*)                                                    AS row UNION ALL
SELECT
  'active:'  || count(*) FILTER (WHERE state='active')                       AS row UNION ALL
SELECT
  'idle:'    || count(*) FILTER (WHERE state='idle')                         AS row UNION ALL
SELECT
  'idle_tx:' || count(*) FILTER (WHERE state='idle in transaction')         AS row UNION ALL
SELECT
  'longest_query_secs:' || COALESCE(MAX(EXTRACT(EPOCH FROM (now() - query_start)))::int, 0)::text
FROM pg_stat_activity WHERE datname = current_database();
" 2>&1 | head -10

hdr "7. Long-held / idle-in-transaction connections (these LEAK pools)"
psql -A -t "$DBURL" -c "
SELECT pid || ' | ' || state || ' | ' || (now() - state_change)::text || ' | ' || COALESCE(substring(query, 1, 100), '?')
FROM pg_stat_activity
WHERE state IN ('idle in transaction','active')
  AND state_change < now() - INTERVAL '30 seconds'
  AND datname = current_database()
ORDER BY state_change LIMIT 10;
" 2>&1 | head -15

hdr "8. Socket.IO connection count (rough)"
# Active sockets = unique X-Forwarded-For hitting /socket.io in nginx access log
sudo grep -c "socket.io/?EIO=4" /var/log/nginx/access.log 2>/dev/null | head -1 \
  | awk '{print "  total socket.io hits in nginx log: " $1}'

hdr "9. Memory growth check — restart counts + uptime"
pm2 jlist 2>/dev/null \
  | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  for p in data:
    n  = p.get('name')
    pm = p.get('pm2_env', {})
    mon = p.get('monit', {})
    print(f\"  {n}: status={pm.get('status')} restarts={pm.get('restart_time')} uptime={pm.get('pm_uptime',0)} mem={mon.get('memory',0)//(1024*1024)}MB cpu={mon.get('cpu',0)}%\")
except Exception as e:
  print(f'  (could not parse pm2 jlist: {e})')
" || true

hdr "10. Recent restart reasons (last 5)"
pm2 logs crm-backend --err --nostream --lines 200 2>/dev/null \
  | grep -iE "shutting down|signal|exited|fatal|out of memory|FATAL" | tail -10 || echo "(none)"

hdr "VERDICT"
echo "Read sections 2-4. The top 1-3 error messages there are responsible"
echo "for most of your 'Internal Server Error' UI popups. Paste them back"
echo "and I'll write a targeted fix — not a speculative one."
echo ""
echo "If section 7 has rows older than 5 minutes → connection leak in a"
echo "specific handler (will look like 'idle in transaction' or 'active'"
echo "with a long state_change). Tell me the query text and I'll fix the"
echo "missing await/release."
echo ""
echo "If section 9 shows restart_count > 5 and rising → backend is crashing"
echo "on a specific path. Tell me the restart reasons from section 10."
