#!/usr/bin/env bash
# Sharp diagnostic for "Meta leads not appearing in CRM dashboard".
# Run ON THE VPS — reads DATABASE_URL from backend/.env, mints a real
# admin JWT, hits both the DB directly and the API endpoints the
# dashboard hits. Tells you, with no guessing, whether the leads are
# missing from the DB or just hidden by a stale UI / wrong query.
#
# Usage:
#   bash scripts/diagnose-fb-leads.sh
#   PUBLIC_URL=http://127.0.0.1:4000 bash scripts/diagnose-fb-leads.sh

set -uo pipefail
cd "$(dirname "$0")/.."

PUBLIC_URL="${PUBLIC_URL:-https://crm.digitaladbird.com}"

hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
grn() { printf "\033[32m%s\033[0m\n" "$*"; }
amber() { printf "\033[33m%s\033[0m\n" "$*"; }

[ -f backend/.env ] || { red "backend/.env missing"; exit 1; }
DBURL=$(grep -E '^DATABASE_URL=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
PSQL="psql -A -t -F| $DBURL"

hdr "0. Currently-deployed commit + migration state"
git -C "$(pwd)" log -1 --oneline
$PSQL <<SQL
SELECT 'TZ session = ' || current_setting('TimeZone');
SELECT 'now()       = ' || now()::text;
SELECT 'now() IST   = ' || (now() AT TIME ZONE 'Asia/Kolkata')::text;
SELECT 'today UTC   = ' || CURRENT_DATE::text;
SELECT 'today IST   = ' || (now() AT TIME ZONE 'Asia/Kolkata')::date::text;
SQL
echo
echo "Latest 3 applied migrations:"
$PSQL -c "SELECT filename || ' (' || applied_at::text || ')' FROM schema_migrations ORDER BY applied_at DESC LIMIT 3"

hdr "1. THE KEY QUESTION — are the 44 leads in the DB at all?"
echo
echo "Total Meta leads:"
$PSQL -c "SELECT COUNT(*) FROM leads WHERE source='meta' AND deleted_at IS NULL"
echo
echo "Meta leads created in the LAST 24 HOURS (absolute time, tz-independent):"
$PSQL -c "SELECT COUNT(*) FROM leads WHERE source='meta' AND created_at > NOW() - INTERVAL '24 hours' AND deleted_at IS NULL"
echo
echo "Meta leads with TODAY-IN-IST date (what the dashboard tile should show):"
$PSQL -c "SELECT COUNT(*) FROM leads WHERE source='meta' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date AND deleted_at IS NULL"
echo
echo "Meta leads using the OLD broken query (created_at::date = CURRENT_DATE):"
$PSQL -c "SELECT COUNT(*) FROM leads WHERE source='meta' AND created_at::date = CURRENT_DATE AND deleted_at IS NULL"
echo
echo "Recent 10 Meta leads (ts shown in BOTH UTC and IST):"
$PSQL <<SQL
SELECT '  ' || created_at::text || '  IST=' || (created_at AT TIME ZONE 'Asia/Kolkata')::text || '  ' || COALESCE(full_name,'?') || ' / ' || COALESCE(campaign_name,'?')
  FROM leads WHERE source='meta' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10;
SQL
echo
echo "→ If LAST 24 HOURS = 0 → leads never made it to DB. Webhook problem (see sections 4-8)."
echo "→ If LAST 24 HOURS > 0 but TODAY-IN-IST = 0 → DB has them under yesterday-IST. Check tz."
echo "→ If TODAY-IN-IST = 44 but OLD-broken = 0 → confirms the SQL fix is needed (this commit fixes it)."

hdr "2. Webhook ingestion log (meta_sync_log + audit)"
echo "sync_log rows last 24h:"
$PSQL -c "SELECT COUNT(*) FROM meta_sync_log WHERE started_at > NOW() - INTERVAL '24 hours'"
echo
echo "Last 10 sync_log entries:"
$PSQL <<SQL
SELECT '  ' || started_at::text || ' | ' || sync_type || ' | status=' || COALESCE(status,'?') || ' | created=' || COALESCE(leads_created::text,'?') || ' | dup=' || COALESCE(leads_duplicate::text,'?')
  FROM meta_sync_log ORDER BY started_at DESC LIMIT 10;
SQL
echo
echo "→ If empty after 24h → Meta isn't hitting /webhooks/meta at all."

hdr "3. Page access tokens — webhook needs an active token per page"
$PSQL <<SQL
SELECT '  page_id=' || page_id || '  active=' || is_active::text || '  name=' || COALESCE(page_name,'?') || '  token_present=' || (page_access_token IS NOT NULL)::text
  FROM meta_pages;
SQL

hdr "4. PM2 backend log — webhook activity in the last 500 lines"
if command -v pm2 >/dev/null; then
  pm2 logs crm-backend --nostream --lines 500 2>/dev/null \
    | grep -iE "webhook|leadgen|BAD_SIGNATURE|no_token|Meta lead|phone/email already|Failed to ingest" \
    | tail -40 || echo "  (no matching lines — Meta hasn't called us recently)"
else
  echo "  (pm2 not installed)"
fi

hdr "5. Nginx access log — has Meta hit /webhooks/meta at all?"
for log in /var/log/nginx/access.log /var/log/nginx/access.log.1; do
  [ -r "$log" ] && {
    echo "  Hits in $log (last 10):"
    grep "/webhooks/meta" "$log" | tail -10 || echo "    (none)"
  }
done

hdr "6. Webhook verify endpoint — externally reachable + token matches?"
META_TOKEN=$(grep -E '^META_VERIFY_TOKEN=' backend/.env | head -1 | cut -d= -f2- | tr -d '"')
code=$(curl -s -o /tmp/v -w "%{http_code}" "$PUBLIC_URL/webhooks/meta?hub.mode=subscribe&hub.verify_token=$META_TOKEN&hub.challenge=PROBE_OK")
body=$(cat /tmp/v)
if [ "$code" = "200" ] && [ "$body" = "PROBE_OK" ]; then
  grn "  ✔ verify endpoint reachable + token correct"
else
  red "  ✘ HTTP:$code body:$body — Meta CANNOT subscribe to this app"
fi

hdr "7. What the API endpoints actually return (with a real admin JWT)"
# Mint a token using the running backend's JWT secret
JWT=$(cd backend && node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: [u] } = await c.query(\"SELECT id, role, full_name FROM users WHERE role='super_admin' AND deleted_at IS NULL LIMIT 1\");
  await c.end();
  console.log(jwt.sign({ sub: u.id, role: u.role, name: u.full_name },
                       process.env.JWT_ACCESS_SECRET,
                       { expiresIn: '5m', issuer: 'digitaladbird-crm' }));
})().catch(e => { console.error('JWT_MINT_ERR', e.message); process.exit(1); });
" 2>&1)
if [ -z "$JWT" ] || echo "$JWT" | grep -q ERR; then
  red "  ✘ Could not mint admin JWT: $JWT"
else
  for ep in /api/reports/summary /api/admin/leads/fresh?scope=today /api/admin/live-stats /api/admin/meta/campaigns-enriched; do
    code=$(curl -s -o /tmp/r -w "%{http_code}" -H "Authorization: Bearer $JWT" "$PUBLIC_URL$ep")
    snippet=$(cat /tmp/r | head -c 200)
    printf "  GET %-45s HTTP:%s  %s\n" "$ep" "$code" "$snippet"
  done
fi

hdr "8. Dedup pressure — how many recent Meta leads were rejected for phone match"
echo "Meta leads in last 24h whose phone exists in a DIFFERENT older lead:"
$PSQL <<SQL
SELECT '  matching: ' || COUNT(*)::text
  FROM leads l1
 WHERE l1.source = 'meta'
   AND l1.created_at > NOW() - INTERVAL '24 hours'
   AND l1.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM leads l2
      WHERE l2.id <> l1.id AND l2.phone = l1.phone
        AND l2.deleted_at IS NULL
        AND l2.created_at < l1.created_at
   );
SQL
echo "→ findExistingByContact() has a 30-day window now (LEAD_DEDUP_WINDOW_DAYS)."
echo "  If you suspect the window is dropping legitimate new leads, re-run"
echo "  the recovery with the window disabled:"
echo "    LEAD_DEDUP_WINDOW_DAYS=0 node backend/scripts/recover-meta-leads.js"

hdr "VERDICT"
echo "Read the numbers above in order. The 4-state matrix:"
echo ""
echo "  A. Section 1 'last 24h' = 0  AND  section 2 sync_log empty"
echo "     → Meta isn't sending. Check Meta App Dashboard subscription,"
echo "       page subscription, app live mode, leadgen field, callback URL."
echo ""
echo "  B. Section 1 'last 24h' = 0  AND  section 2 sync_log has rows"
echo "     → Meta sent, backend rejected. Check section 4 logs for"
echo "       BAD_SIGNATURE (wrong META_APP_SECRET) or no_token (expired"
echo "       page token in meta_pages)."
echo ""
echo "  C. Section 1 'last 24h' > 0  AND  Section 7 shows today=0"
echo "     → Leads ARE in DB but the API is filtering them out."
echo "       This is fixed by commit bb5cc02 (IST-explicit SQL). If you see"
echo "       this, you haven't pulled and restarted yet:"
echo "         git pull && pm2 delete crm-backend && \\"
echo "         pm2 start ecosystem.config.js --update-env"
echo ""
echo "  D. Section 1 'today-IST' > 0  AND  Section 7 shows the same number"
echo "     → Everything works. The dashboard is stale — hard refresh"
echo "       (Ctrl+Shift+R) and clear React Query cache."
