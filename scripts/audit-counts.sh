#!/usr/bin/env bash
# Print actual lead counts from every layer so we can compare local vs prod.
# Run on EACH environment, paste BOTH outputs back to compare side-by-side.
#
#   bash scripts/audit-counts.sh
#
# Prints:
#   [DB]   raw COUNT(*) per dimension (today / yesterday / day-before / per-campaign / per-form / per-source / by category / by assignee)
#   [API]  what the dashboard endpoints return for an admin JWT
#
# When two environments disagree the diff is the bug. Likely causes:
#   - Different DATABASE_URL → backend reading a different DB
#   - JWT minted for non-admin user → role-scoped count
#   - Stale cache → API returns old number (use /api/admin/live-stats?_=$(date +%s) to bypass)

set -uo pipefail
cd "$(dirname "$0")/.."

hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

# ============================================================
hdr "ENV"
# ============================================================
echo "host    : $(hostname)"
echo "commit  : $(git log -1 --oneline 2>/dev/null)"
DBURL=$(grep -E '^DATABASE_URL=' backend/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
SAFE=$(echo "$DBURL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')
echo "DB URL  : $SAFE"

# ============================================================
hdr "[DB] Direct COUNT(*) per dimension"
# ============================================================
psql -A -t -F'|' "$DBURL" 2>&1 <<'SQL'
SELECT 'DB name                  ' AS metric, current_database() AS value
UNION ALL SELECT 'DB session timezone      ', current_setting('TimeZone')
UNION ALL SELECT 'now()                    ', now()::text
UNION ALL SELECT 'today (IST)              ', (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'users (active)           ', COUNT(*)::text FROM users WHERE deleted_at IS NULL
UNION ALL SELECT 'leads (active)           ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
UNION ALL SELECT 'leads.source=meta        ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND source='meta'
UNION ALL SELECT 'leads.source=import      ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND source='import'
UNION ALL SELECT 'leads.source=manual      ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND source='manual'
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'today_IST   (Meta time)  ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
   AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
UNION ALL SELECT 'yesterday_IST            ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
   AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1
UNION ALL SELECT 'day_before_yesterday_IST ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
   AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 2
UNION ALL SELECT 'last_7_days              ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
   AND COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '7 days'
UNION ALL SELECT 'last_30_days             ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL
   AND COALESCE(meta_created_time, created_at) > NOW() - INTERVAL '30 days'
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'unassigned in queue      ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NULL
UNION ALL SELECT 'assigned                 ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL
UNION ALL SELECT 'is_pending=TRUE          ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND is_pending=TRUE
UNION ALL SELECT 'call_status=converted    ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND call_status='converted'
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'category=partner         ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND category='partner'
UNION ALL SELECT 'category=trader          ', COUNT(*)::text FROM leads WHERE deleted_at IS NULL AND category='trader'
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'meta_pages active        ', COUNT(*)::text FROM meta_pages WHERE is_active=TRUE
UNION ALL SELECT 'meta_forms               ', COUNT(*)::text FROM meta_forms
UNION ALL SELECT 'integration_configs      ', COUNT(*)::text FROM integration_configs
UNION ALL SELECT 'lead_requests pending    ', COUNT(*)::text FROM lead_requests WHERE status='pending'
UNION ALL SELECT 'lead_requests fulfilled  ', COUNT(*)::text FROM lead_requests WHERE status='fulfilled'
UNION ALL SELECT '---', '---'
UNION ALL SELECT 'lead_requests VIOLATIONS ', COUNT(*)::text FROM lead_requests WHERE status='fulfilled' AND leads_assigned < quantity
;
SQL

hdr "[DB] Per-campaign breakdown (top 10 by total, today vs total)"
psql -A -F'|' "$DBURL" 2>&1 <<'SQL'
SELECT
  COALESCE(campaign_name, '(no campaign)') AS campaign,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today,
  COUNT(*) FILTER (WHERE assigned_to_user_id IS NULL) AS unassigned
FROM leads WHERE deleted_at IS NULL AND source='meta'
GROUP BY 1 ORDER BY total DESC LIMIT 10;
SQL

hdr "[DB] Per-form breakdown"
psql -A -F'|' "$DBURL" 2>&1 <<'SQL'
SELECT
  COALESCE(meta_form_id, '(no form_id)') AS form_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today
FROM leads WHERE deleted_at IS NULL AND source='meta'
GROUP BY 1 ORDER BY total DESC LIMIT 10;
SQL

# ============================================================
hdr "[API] Same numbers via the dashboard endpoints"
# ============================================================
PUB="${PUBLIC_URL:-http://127.0.0.1:4000}"

JWT=$(cd backend && node -e "
require('dotenv').config();
const jwt=require('jsonwebtoken');
const{Client}=require('pg');
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL});
  await c.connect();
  const{rows:[u]}=await c.query(\"SELECT id, role, full_name FROM users WHERE role='super_admin' AND deleted_at IS NULL LIMIT 1\");
  await c.end();
  if(!u){console.error('NO_ADMIN');process.exit(1);}
  console.error('admin = ' + u.full_name);
  console.log(jwt.sign({sub:u.id,role:u.role,name:u.full_name},process.env.JWT_ACCESS_SECRET,{expiresIn:'5m',issuer:'digitaladbird-crm'}));
})();" 2>&1)
ADMIN=$(echo "$JWT" | grep '^admin = ')
JWT=$(echo "$JWT" | grep -v '^admin = ' | tail -1)
echo "$ADMIN"
if [ -z "$JWT" ] || [ "$JWT" = "NO_ADMIN" ]; then
  echo "Could not mint admin JWT — skipping API probe"
else
  for ep in "/api/admin/live-stats?_=$(date +%s)" "/api/reports/summary?_=$(date +%s)" "/api/admin/leads/fresh?scope=today&_=$(date +%s)" "/api/distribution/stats?_=$(date +%s)"; do
    body=$(curl -s -H "Authorization: Bearer $JWT" "$PUB$ep")
    echo
    echo "GET $ep"
    echo "$body" | grep -oE '"(total_leads|today_leads|today_received|queued_leads|today_total|today_partner|today_trader|trader_total|partner_total)":[0-9]+' | sed 's/^/  /'
  done
fi

# ============================================================
hdr "DONE"
# ============================================================
echo "Paste this entire output for comparison."
echo "Run the same script on the OTHER environment (local OR prod)."
echo "Any line that differs identifies the gap."
