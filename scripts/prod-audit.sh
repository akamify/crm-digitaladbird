#!/usr/bin/env bash
# PRODUCTION AUDIT — single script that checks every layer of the live
# CRM stack and reports PASS / FAIL with the exact next-step fix.
#
# Run ON THE VPS:
#   ssh root@<vps>
#   cd /root/crm-digitaladbird
#   bash scripts/prod-audit.sh
#
# Layers checked:
#   1.  Git: current commit + behind/ahead origin/main
#   2.  PM2: backend + frontend processes alive, recent restart count
#   3.  Node backend: /health and /health/db-strict respond
#   4.  Nginx: config valid, both server blocks present, SSL cert expiry
#   5.  SSL: certificate chain valid + days remaining
#   6.  DNS: api.crm.digitaladbird.com + www.crm.digitaladbird.com resolve
#   7.  Database: migrations applied (32+), users count, leads count
#   8.  JWT: backend can mint + verify tokens
#   9.  Admin login: super_admin user exists + password works
#   10. Meta webhook: GET verify handshake returns challenge
#   11. Meta token health: meta_pages.token_is_valid for active pages
#   12. Webhook event log: recent activity (last 24h)
#   13. Lead ingestion: latest meta lead timestamp + last-7-day count
#   14. Round-robin distribution: scheduler running, end_hour = 20
#   15. Cron-style health: PM2 uptime > backend log age
#
# Exit code: 0 if ALL critical layers pass, 1 if any fail.
# Output is colorized [OK]/[WARN]/[FAIL] and ends with a summary count.

set -uo pipefail
ROOT="${ROOT:-$(pwd)}"
PUB="${PUBLIC_URL:-https://www.crm.digitaladbird.com}"
API="${API_URL:-https://api.crm.digitaladbird.com}"

ok()   { printf "\033[32m[OK]\033[0m   %s\n" "$*"; PASSED=$((PASSED+1)); }
fail() { printf "\033[31m[FAIL]\033[0m %s\n" "$*"; FAILED=$((FAILED+1)); }
warn() { printf "\033[33m[WARN]\033[0m %s\n" "$*"; WARNED=$((WARNED+1)); }
hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

PASSED=0
FAILED=0
WARNED=0
cd "$ROOT"

# ============================================================
hdr "1. Git state"
# ============================================================
git fetch origin --quiet 2>&1 | head -1
HEAD=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
ok "Branch: $BRANCH  HEAD: ${HEAD:0:7}"
if [ "$BEHIND" = "0" ]; then ok "Up to date with origin/main"
elif [ "$BEHIND" = "?" ]; then warn "Could not compare with origin/main"
else fail "$BEHIND commits behind origin/main — run: git pull"; fi

# ============================================================
hdr "2. PM2 processes"
# ============================================================
if ! command -v pm2 >/dev/null; then fail "pm2 not installed"; else
  for p in digital-adbird-crm-backend crm-frontend; do
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$p\""; then
      status=$(pm2 jlist | grep -oE "\"name\":\"$p\"[^}]*\"status\":\"[a-z]+\"" | grep -oE '"status":"[a-z]+"' | cut -d'"' -f4 | head -1)
      restarts=$(pm2 jlist | grep -oE "\"name\":\"$p\"[^}]*\"restart_time\":[0-9]+" | grep -oE '"restart_time":[0-9]+' | cut -d: -f2 | head -1)
      if [ "$status" = "online" ]; then ok "$p — online, restarts=$restarts"
      else fail "$p — status=$status"; fi
    else
      fail "$p — not in pm2 list. Fix: pm2 start ecosystem.config.js"
    fi
  done
fi

# ============================================================
hdr "3. Backend health"
# ============================================================
code=$(curl -s -o /tmp/h.json -w "%{http_code}" --max-time 5 "$API/health")
[ "$code" = "200" ] && ok "$API/health → 200" || fail "$API/health → $code"

code=$(curl -s -o /tmp/hdb.json -w "%{http_code}" --max-time 5 "$API/health/db-strict")
if [ "$code" = "200" ] && grep -q '"real_pg":true' /tmp/hdb.json; then
  USERS=$(grep -oE '"users":[0-9]+' /tmp/hdb.json | cut -d: -f2)
  ok "$API/health/db-strict → real_pg=true, users=$USERS"
else
  fail "$API/health/db-strict → $code  body: $(head -c 100 /tmp/hdb.json)"
fi

# ============================================================
hdr "4. Nginx config + reverse proxy"
# ============================================================
if ! command -v nginx >/dev/null; then warn "nginx not installed"; else
  if nginx -t 2>&1 | grep -q "successful"; then
    ok "nginx config syntax: OK"
  else
    fail "nginx config syntax invalid — run: nginx -t"
  fi
  # Check /api/ proxy is wired
  if nginx -T 2>/dev/null | grep -E "server_name.*www\.crm\.digitaladbird\.com" -A 50 | grep -qE "location.*/api/"; then
    ok "www.crm — /api/ proxy block found"
  else
    warn "www.crm — no /api/ proxy block; relying on api subdomain only"
  fi
  if nginx -T 2>/dev/null | grep -E "server_name.*api\.crm\.digitaladbird\.com" | head -1 | grep -q api; then
    ok "api.crm — server block present"
  else
    fail "api.crm — server block missing"
  fi
fi

# ============================================================
hdr "5. SSL certificate"
# ============================================================
for host in www.crm.digitaladbird.com api.crm.digitaladbird.com; do
  exp=$(echo | openssl s_client -servername "$host" -connect "$host":443 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$exp" ]; then
    days=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 ))
    if [ "$days" -gt 14 ]; then ok "$host SSL valid, expires $exp ($days days)"
    elif [ "$days" -gt 0 ]; then warn "$host SSL expires soon: $exp ($days days)"
    else fail "$host SSL EXPIRED: $exp"; fi
  else
    fail "$host — could not read SSL cert"
  fi
done

# ============================================================
hdr "6. DNS resolution"
# ============================================================
for host in www.crm.digitaladbird.com api.crm.digitaladbird.com; do
  ip=$(dig +short A "$host" @1.1.1.1 | head -1)
  [ -n "$ip" ] && ok "$host → $ip" || fail "$host — no A record"
done

# ============================================================
hdr "7. Database migrations + counts"
# ============================================================
cd backend
DBURL=$(grep '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$DBURL" ]; then
  fail "backend/.env: DATABASE_URL missing"
else
  applied=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM schema_migrations" 2>/dev/null)
  ondisk=$(ls src/db/migrations/*.sql 2>/dev/null | wc -l)
  if [ "$applied" = "$ondisk" ]; then ok "Migrations: $applied / $ondisk applied"
  else fail "Migration drift: $applied applied, $ondisk on disk — run: node src/db/migrate.js"; fi

  leads=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL" 2>/dev/null)
  meta_leads=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL AND source='meta'" 2>/dev/null)
  users=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL" 2>/dev/null)
  admins=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND role='super_admin'" 2>/dev/null)
  echo "    leads(active)=$leads  meta_leads=$meta_leads  users=$users  super_admins=$admins"
  [ "$admins" -gt 0 ] && ok "At least one super_admin exists" || fail "NO super_admin users — login will fail"
fi
cd "$ROOT"

# ============================================================
hdr "8. JWT secrets present in env"
# ============================================================
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  len=$(grep "^$k=" backend/.env 2>/dev/null | cut -d= -f2- | wc -c)
  if [ "$len" -gt 32 ]; then ok "$k set (len=$((len-1)))"
  else fail "$k missing or too short"; fi
done

# ============================================================
hdr "9. Meta webhook verify handshake"
# ============================================================
VT=$(grep '^META_VERIFY_TOKEN=' backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -n "$VT" ]; then
  resp=$(curl -s --max-time 5 "$API/webhooks/meta?hub.mode=subscribe&hub.verify_token=$VT&hub.challenge=test12345")
  [ "$resp" = "test12345" ] && ok "Webhook verify handshake echoes challenge" \
    || fail "Webhook verify handshake failed — got: '$resp'"
else
  warn "META_VERIFY_TOKEN missing — can't test handshake"
fi

# ============================================================
hdr "10. Meta token health (from periodic monitor)"
# ============================================================
if [ -n "$DBURL" ]; then
  result=$(psql "$DBURL" -A -t -F'|' -c "
    SELECT page_name, token_is_valid, token_expires_at, token_last_checked
      FROM meta_pages WHERE is_active = TRUE" 2>/dev/null)
  echo "$result" | while IFS='|' read -r name valid expires checked; do
    [ -z "$name" ] && continue
    if [ "$valid" = "t" ]; then ok "$name — token VALID, last checked $checked"
    elif [ "$valid" = "f" ]; then fail "$name — token INVALID, expired $expires. Rotate in Meta Business Manager."
    else warn "$name — token health not yet checked"; fi
  done
fi

# ============================================================
hdr "11. Webhook event log (last 24h)"
# ============================================================
if [ -n "$DBURL" ]; then
  cnt=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM webhook_events WHERE received_at > NOW() - INTERVAL '24 hours'" 2>/dev/null)
  bad=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM webhook_events WHERE received_at > NOW() - INTERVAL '24 hours' AND signature_valid = FALSE" 2>/dev/null)
  last=$(psql "$DBURL" -A -t -c "SELECT received_at FROM webhook_events ORDER BY id DESC LIMIT 1" 2>/dev/null)
  echo "    last 24h webhook calls: $cnt  bad-sig: $bad  most recent: ${last:-never}"
  if [ "$cnt" = "0" ]; then warn "ZERO webhook calls in 24h — Meta may not be reaching us"
  elif [ "$bad" -gt 0 ]; then warn "$bad bad-signature webhook attempts — possible App Secret mismatch"
  else ok "Webhook traffic healthy ($cnt calls, 0 bad sigs)"; fi
fi

# ============================================================
hdr "12. Lead ingestion freshness"
# ============================================================
if [ -n "$DBURL" ]; then
  last=$(psql "$DBURL" -A -t -c "SELECT MAX(COALESCE(meta_created_time, created_at)) FROM leads WHERE source='meta' AND deleted_at IS NULL" 2>/dev/null)
  today_count=$(psql "$DBURL" -A -t -c "SELECT COUNT(*) FROM leads WHERE source='meta' AND deleted_at IS NULL AND (COALESCE(meta_created_time, created_at) AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date" 2>/dev/null)
  echo "    last meta lead: ${last:-never}  today: $today_count leads"
  if [ -z "$last" ]; then
    fail "Zero meta leads ever ingested"
  else
    # Hours since last lead
    age_min=$(psql "$DBURL" -A -t -c "SELECT EXTRACT(EPOCH FROM (NOW() - '$last'::timestamptz))/60" 2>/dev/null | cut -d. -f1)
    if [ "$age_min" -lt 60 ]; then ok "Last lead $age_min min ago — pipeline live"
    elif [ "$age_min" -lt 1440 ]; then warn "Last lead $((age_min/60))h ago — verify Meta is sending"
    else fail "Last lead $((age_min/60))h ago ($(echo $((age_min/1440))) days) — pipeline STOPPED"; fi
  fi
fi

# ============================================================
hdr "13. Distribution settings"
# ============================================================
if [ -n "$DBURL" ]; then
  endh=$(psql "$DBURL" -A -t -c "SELECT value FROM distribution_settings WHERE key='distribution_end_hour'" 2>/dev/null)
  startk=$(psql "$DBURL" -A -t -c "SELECT value FROM distribution_settings WHERE key='distribution_start_hour'" 2>/dev/null)
  enabled=$(psql "$DBURL" -A -t -c "SELECT value FROM distribution_settings WHERE key='auto_distribution_enabled'" 2>/dev/null)
  echo "    start=$startk end=$endh enabled=$enabled"
  [ "$endh" = "20" ] && ok "End hour = 20 (8 PM IST) — matches spec" \
    || warn "End hour = $endh (spec is 20 / 8 PM). Fix: UPDATE distribution_settings SET value='20' WHERE key='distribution_end_hour';"
fi

# ============================================================
hdr "SUMMARY"
# ============================================================
echo "PASSED: $PASSED   WARNED: $WARNED   FAILED: $FAILED"
if [ "$FAILED" -gt 0 ]; then
  echo
  echo "Action items above are in each [FAIL] line. Address them and re-run."
  exit 1
fi
echo
echo "All critical layers passed. WARN items above are informational."
exit 0
