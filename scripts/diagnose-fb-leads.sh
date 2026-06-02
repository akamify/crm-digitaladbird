#!/usr/bin/env bash
# Run ON THE VPS to find where the missing Meta leads went.
#
# Usage:
#   bash scripts/diagnose-fb-leads.sh
#
# Reads DATABASE_URL from backend/.env, queries Postgres, and prints a
# verdict for each of the most-likely failure points.

set -euo pipefail
cd "$(dirname "$0")/.."
[ -f backend/.env ] || { echo "backend/.env missing"; exit 1; }

DBURL=$(grep -E '^DATABASE_URL=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
[ -z "$DBURL" ] && { echo "DATABASE_URL not set in backend/.env"; exit 1; }

# psql -A -t -F'|' = unaligned tuples-only, pipe-delimited
PSQL="psql -A -t -F| $DBURL"

hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
grn() { printf "\033[32m%s\033[0m\n" "$*"; }

hdr "0. DB timezone — this drives all 'today' filters"
$PSQL <<SQL
SELECT 'now()=' || now()::text,
       'today_in_db=' || CURRENT_DATE::text,
       'TZ=' || current_setting('TimeZone');
SELECT 'IST equivalent of now: ' || (now() AT TIME ZONE 'Asia/Kolkata')::text;
SQL
echo
echo "→ If 'TZ' is UTC and you're checking late at night IST, leads arriving"
echo "  between 18:30 UTC and 23:59 UTC will count as TOMORROW in IST, or"
echo "  as YESTERDAY's date in UTC — the 'today' tile will under-report."

hdr "1. Meta leads in the LAST 24 HOURS (absolute time, not date)"
$PSQL <<SQL
SELECT '  total last 24h:        ' || COUNT(*)::text FROM leads WHERE source='meta' AND created_at > NOW() - INTERVAL '24 hours' AND deleted_at IS NULL;
SELECT '  total last 12h:        ' || COUNT(*)::text FROM leads WHERE source='meta' AND created_at > NOW() - INTERVAL '12 hours' AND deleted_at IS NULL;
SELECT '  total last 6h:         ' || COUNT(*)::text FROM leads WHERE source='meta' AND created_at > NOW() - INTERVAL '6 hours' AND deleted_at IS NULL;
SELECT '  total last 1h:         ' || COUNT(*)::text FROM leads WHERE source='meta' AND created_at > NOW() - INTERVAL '1 hour' AND deleted_at IS NULL;
SQL
echo
echo "→ If last-24h is close to 44 → leads ARE in DB. Problem is the 'today'"
echo "  date filter or the dashboard cache (refresh hard / clear React Query)."
echo "→ If last-24h is 0 → leads never reached the DB. Continue to step 2."

hdr "2. Webhook receipt log — did Meta even hit our /webhooks/meta?"
$PSQL <<SQL
SELECT '  meta_sync_log rows last 24h: ' || COUNT(*)::text FROM meta_sync_log WHERE started_at > NOW() - INTERVAL '24 hours';
SELECT '  audit_logs meta entries 24h: ' || COUNT(*)::text FROM audit_logs WHERE entity IN ('meta','webhook','lead_ingestion') AND created_at > NOW() - INTERVAL '24 hours';
SQL
echo "  Recent sync log entries:"
$PSQL <<SQL
SELECT '  ' || started_at::text || ' | ' || sync_type || ' | status=' || COALESCE(status,'?') || ' | created=' || COALESCE(leads_created::text,'?') || ' | dup=' || COALESCE(leads_duplicate::text,'?')
  FROM meta_sync_log ORDER BY started_at DESC LIMIT 10;
SQL
echo
echo "→ If empty → Meta isn't reaching backend. Causes: subscription lapsed,"
echo "  page token expired, wrong webhook URL, signature verify failing,"
echo "  or nginx not forwarding /webhooks. Check next steps."

hdr "3. Page access tokens — webhook ingest needs an ACTIVE page token"
$PSQL <<SQL
SELECT '  page_id=' || page_id || ' | active=' || is_active::text || ' | name=' || COALESCE(page_name,'?') || ' | token_set=' || (page_access_token IS NOT NULL)::text
  FROM meta_pages;
SQL
echo
echo "→ Every connected page MUST have active=true and a token. If token=false"
echo "  any webhook arriving for that page silently drops with 'no_token'."

hdr "4. PM2 backend logs — last 100 webhook-related lines"
if command -v pm2 >/dev/null; then
  pm2 logs crm-backend --nostream --lines 500 2>/dev/null | grep -iE "webhook|leadgen|meta lead|BAD_SIGNATURE|no_token|phone/email already" | tail -40 || echo "  (no matching log lines)"
else
  echo "  (pm2 not installed — check backend.log manually)"
fi
echo
echo "→ Look for:"
echo "    'BAD_SIGNATURE'        → META_APP_SECRET on VPS doesn't match Meta app secret"
echo "    'no_token'             → page token expired/wrong"
echo "    'phone/email already'  → being deduped against historical leads"
echo "    'Failed to ingest'     → Graph API error or DB error"

hdr "5. nginx access log — is Meta even hitting us?"
NGINX_LOG="/var/log/nginx/access.log"
if [ -r "$NGINX_LOG" ]; then
  echo "  Hits to /webhooks/meta in last 200 lines of access.log:"
  grep "/webhooks/meta" "$NGINX_LOG" | tail -10 || echo "  (none)"
else
  echo "  (cannot read $NGINX_LOG — try: sudo grep /webhooks/meta /var/log/nginx/access.log | tail)"
fi
echo
echo "→ If you see POST /webhooks/meta with 200 → reaching us. If 401 →"
echo "  signature failing. If 404 → nginx not forwarding. If nothing →"
echo "  Meta isn't sending."

hdr "6. Dedup pressure — how many recent Meta leads share phone with existing"
$PSQL <<SQL
SELECT '  meta leads in last 24h that have phone matching pre-existing lead: '
       || COUNT(*)::text
  FROM leads l1
 WHERE l1.source = 'meta'
   AND l1.created_at > NOW() - INTERVAL '24 hours'
   AND l1.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM leads l2
      WHERE l2.id <> l1.id AND l2.phone = l1.phone AND l2.deleted_at IS NULL
   );
SQL
echo
echo "→ findExistingByContact() has NO time window. Any phone in your 1346"
echo "  historical leads will silently drop a new submission. If your 'tonight'"
echo "  campaign is retargeting prior leads, every submission is deduped."

hdr "7. The 10 most recent Meta leads — what did actually arrive"
$PSQL <<SQL
SELECT '  ' || created_at::text || ' | ' || COALESCE(full_name,'?') || ' | ' || COALESCE(phone,'?') || ' | ' || COALESCE(campaign_name,'?')
  FROM leads WHERE source='meta' AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 10;
SQL

hdr "8. Test webhook verification from outside"
PUBLIC_URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"
META_TOKEN=$(grep -E '^META_VERIFY_TOKEN=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
code=$(curl -s -o /tmp/v.txt -w "%{http_code}" "$PUBLIC_URL/webhooks/meta?hub.mode=subscribe&hub.verify_token=$META_TOKEN&hub.challenge=PROBE_OK")
body=$(cat /tmp/v.txt)
echo "  GET $PUBLIC_URL/webhooks/meta  →  HTTP:$code  body:$body"
[ "$code" = "200" ] && [ "$body" = "PROBE_OK" ] && grn "  ✔ Verification endpoint reachable + token matches" || red "  ✘ Verification failed — Meta cannot subscribe"

hdr "9. Today filter vs absolute-day filter — direct comparison"
$PSQL <<SQL
SELECT
  '  CURRENT_DATE (DB tz)  → ' || COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::text || ' leads' AS row
  FROM leads WHERE source='meta' AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '48 hours'
UNION ALL
SELECT
  '  Last 24 hours (UTC)  → ' || COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text || ' leads'
  FROM leads WHERE source='meta' AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '48 hours'
UNION ALL
SELECT
  '  Today in IST          → ' || COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::text || ' leads'
  FROM leads WHERE source='meta' AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '48 hours';
SQL
echo
echo "→ If 'CURRENT_DATE' < 'Today in IST' → TZ bug. Fix by setting"
echo "    ALTER DATABASE digitaladbird SET timezone = 'Asia/Kolkata';"
echo "  then restart the backend. New leads + counts will use IST."

hdr "VERDICT"
echo "Read sections 1, 2, 6, 9 to identify which of these is the cause:"
echo "  A. Leads ARE in DB but 'today' tile hides them → TZ bug (section 9)"
echo "  B. Leads ARE in DB, today tile correct, but dashboard stale → React Query cache (hard refresh + check section 5)"
echo "  C. Leads NOT in DB, sync_log shows BAD_SIGNATURE → META_APP_SECRET wrong"
echo "  D. Leads NOT in DB, sync_log shows 'phone/email already' → dedup pressure (section 6)"
echo "  E. Leads NOT in DB, sync_log empty, nginx shows no /webhooks hits → Meta subscription / page token problem"
echo ""
echo "Paste the full output to Claude for next-step fix."
