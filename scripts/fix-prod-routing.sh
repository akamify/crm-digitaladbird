#!/bin/bash
# ============================================================
# DigitalADbird CRM — Production Routing Fix (aggressive)
# ============================================================
# Use when:
#   - https://crm.digitaladbird.com/ shows backend JSON 404
#   - PM2 / Nginx have stale state from previous deploys
#
# This script does NOT touch:
#   - .env files
#   - database
#   - CRM code (only rebuilds + restarts)
#
# Run on the VPS as root:
#   bash /opt/digitaladbird-crm/scripts/fix-prod-routing.sh
# ============================================================
set -euo pipefail

DOMAIN="crm.digitaladbird.com"
APP_DIR="/opt/digitaladbird-crm"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"

echo "================================================================="
echo "  CRM Production Routing Fix — $DOMAIN"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================="

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
[ -d "$APP_DIR" ]    || { echo "Missing $APP_DIR"; exit 1; }

# ── 1. AGGRESSIVE PM2 RESET ──────────────────────────────────
# `pm2 delete` only removes a process — saved dump still has stale
# script paths from older deploys. `pm2 kill` stops the daemon and
# wipes runtime state. We also nuke the dump file so resurrect can't
# bring back the old crm-frontend that ran `next start`.
echo ""
echo "[1/6] Killing PM2 daemon + clearing saved state…"
pm2 kill 2>/dev/null || true
rm -f /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak 2>/dev/null || true
echo "  ✓ PM2 fully reset"

# ── 2. NGINX CLEANUP ─────────────────────────────────────────
# Remove every site config that mentions $DOMAIN, plus the default.
# Then we'll write exactly one fresh config.
echo ""
echo "[2/6] Cleaning up Nginx site configs…"
# Disable all existing enabled sites that mention this domain
for f in /etc/nginx/sites-enabled/*; do
  [ -e "$f" ] || continue
  if grep -q "$DOMAIN" "$f" 2>/dev/null; then
    echo "  removing stale enabled config: $f"
    rm -f "$f"
  fi
done
# Drop default if present
rm -f /etc/nginx/sites-enabled/default
# Remove any other available configs that reference this domain (so they can't be re-enabled)
for f in /etc/nginx/sites-available/*; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  # Keep one canonical filename we'll overwrite next; remove the rest
  if [ "$base" != "$DOMAIN" ] && grep -q "$DOMAIN" "$f" 2>/dev/null; then
    echo "  removing stale available config: $f"
    rm -f "$f"
  fi
done
echo "  ✓ stale configs removed"

# ── 3. REBUILD FRONTEND (standalone) ─────────────────────────
echo ""
echo "[3/6] Rebuilding frontend (standalone)…"
cd "$FRONTEND_DIR"

# Ensure deps are present (production build needs typescript, etc. — full install)
[ -d node_modules ] || npm install 2>&1 | tail -3

# Clean old build so we don't ship a hybrid (.next/standalone left over from
# a build that ran without the standalone flag = file exists but is stale)
rm -rf .next

NODE_ENV=production npm run build 2>&1 | tail -15

if [ ! -f .next/standalone/server.js ]; then
  echo ""
  echo "  ✗ ERROR: .next/standalone/server.js was NOT produced."
  echo "    Cause: next.config.js doesn't have output: 'standalone' for production."
  echo "    Check: grep -n 'output' frontend/next.config.js"
  echo "    Expected: output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,"
  exit 1
fi

# Next.js standalone doesn't bundle static assets or public/ — copy them in
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public || true
echo "  ✓ frontend built: $(cat .next/BUILD_ID)"

# ── 4. WRITE CANONICAL NGINX CONFIG ──────────────────────────
echo ""
echo "[4/6] Writing canonical Nginx config…"

SSL_AVAILABLE=0
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]; then
  SSL_AVAILABLE=1
fi

CONF="/etc/nginx/sites-available/$DOMAIN"
cat > "$CONF" <<NGINX
# Managed by fix-prod-routing.sh — do not hand-edit.
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=webhook_limit:10m rate=60r/s;

upstream crm_backend  { server 127.0.0.1:4000; keepalive 32; }
upstream crm_frontend { server 127.0.0.1:3000; keepalive 16; }

# HTTP → HTTPS redirect (covers both www and apex)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
NGINX

if [ "$SSL_AVAILABLE" -eq 1 ]; then
  cat >> "$CONF" <<NGINX
    location / { return 301 https://$DOMAIN\$request_uri; }
}

# Redirect HTTPS www → HTTPS apex so cookies + CORS only have to handle one origin
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.$DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    return 301 https://$DOMAIN\$request_uri;
}

# Main HTTPS server — apex only
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

NGINX
else
  echo "  (No SSL certs yet — HTTP-only block)"
fi

cat >> "$CONF" <<'NGINX'
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 10M;
    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # /api/* → backend (port 4000)
    location /api/ {
        limit_req zone=api_limit burst=50 nodelay;
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Webhooks (Meta lead-ads) → backend, raw-body friendly
    location /webhooks/ {
        limit_req zone=webhook_limit burst=100 nodelay;
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }

    # Socket.IO (real-time chat) → backend with WebSocket upgrade
    location /socket.io/ {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # Chat file uploads → backend
    location /uploads/ {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
    }

    # Health probe → backend (no rate limit, no log)
    location /health {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        access_log off;
    }

    # Service-worker killer — never cache so unregister logic runs fresh.
    location = /sw.js {
        proxy_pass http://crm_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Pragma "no-cache" always;
        expires 0;
    }

    # Next.js immutable fingerprinted static assets — safe to cache forever.
    location /_next/static/ {
        proxy_pass http://crm_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 365d;
        add_header Cache-Control "public, immutable, max-age=31536000" always;
    }

    # Everything else (/, /login, /dashboard, /leads, etc.) → frontend.
    # No-cache on HTML so a deploy is picked up across Chrome / Edge / mobile
    # without users having to hard-refresh. Static chunks above are still cached.
    location / {
        proxy_pass http://crm_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        # Force HTML revalidation on every request — fixes Chrome/Edge stale UI.
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }
}
NGINX

ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"

echo "  Testing Nginx config…"
nginx -t 2>&1 | sed 's/^/    /'

systemctl reload nginx
echo "  ✓ Nginx reloaded with single canonical config"

# ── 5. START PM2 FRESH ───────────────────────────────────────
echo ""
echo "[5/6] Starting PM2 fresh from ecosystem.config.js…"
mkdir -p /var/log/pm2 /var/log/crm

cd "$APP_DIR"

# Sanity-check ecosystem.config.js has standalone server reference
if ! grep -q "standalone/server.js" ecosystem.config.js; then
  echo "  ⚠ WARNING: ecosystem.config.js doesn't reference .next/standalone/server.js"
  echo "    Run 'git pull' first to get the latest config."
fi

pm2 start ecosystem.config.js --update-env
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root 2>/dev/null || true

sleep 4
echo ""
pm2 list

# ── 6. END-TO-END VERIFY (browser parity + all dashboard routes) ───
echo ""
echo "[6/6] End-to-end verification…"
echo ""

BE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:4000/health || echo "000")
FE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/         || echo "000")

printf "  %-32s HTTP %s   %s\n" "127.0.0.1:4000/health"  "$BE" "(expect 200)"
printf "  %-32s HTTP %s   %s\n" "127.0.0.1:3000/"        "$FE" "(expect 200/307)"

echo ""
echo "  Via Nginx (Host: $DOMAIN):"
for path in /login /dashboard /dashboard/admin /dashboard/rm /dashboard/member /health; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" --max-time 5 "http://127.0.0.1$path" || echo "000")
  printf "    %-28s HTTP %s\n" "$path" "$code"
done

# Browser-parity test — fetch / with Chrome, Edge, and mobile-Safari UAs.
# If anything is non-deterministic per-UA (User-Agent sniffing, locale, etc.),
# the build IDs / first-200-byte fingerprints will differ.
echo ""
echo "  Browser parity (curl with different User-Agent strings):"
UA_CHROME='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
UA_EDGE='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
UA_IOS='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
UA_ANDROID='Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

check_ua() {
  local name="$1"; local ua="$2"
  local code; local body_fp
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" -H "User-Agent: $ua" --max-time 5 "http://127.0.0.1/login" || echo "000")
  # Extract the buildId Next.js injects so we can compare across UAs.
  body_fp=$(curl -s -H "Host: $DOMAIN" -H "User-Agent: $ua" --max-time 5 "http://127.0.0.1/login" \
    | grep -oE '"buildId":"[^"]+"' | head -1)
  printf "    %-12s HTTP %s   %s\n" "$name" "$code" "${body_fp:-<no buildId>}"
}
check_ua "Chrome"   "$UA_CHROME"
check_ua "Edge"     "$UA_EDGE"
check_ua "iOS"      "$UA_IOS"
check_ua "Android"  "$UA_ANDROID"
echo "    (all buildId values should be identical — that's browser parity)"

# Verify Cache-Control headers on HTML so browsers can't cache stale UI.
echo ""
echo "  Response headers on / (must include 'no-cache' for HTML):"
curl -sI -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/ | grep -iE "cache-control|content-type|x-frame" | sed 's/^/    /'

echo ""
echo "  Response headers on /_next/static (must say 'immutable'):"
NEXT_STATIC=$(curl -s -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/ | grep -oE '/_next/static/[^"]+\.js' | head -1)
if [ -n "$NEXT_STATIC" ]; then
  curl -sI -H "Host: $DOMAIN" --max-time 5 "http://127.0.0.1$NEXT_STATIC" | grep -iE "cache-control|content-type" | sed 's/^/    /'
else
  echo "    (no static chunk found in / response — frontend may not be serving)"
fi

echo ""
echo "  Service-worker killer (must respond 200, content-type js, no-cache):"
curl -sI -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/sw.js | grep -iE "HTTP|cache-control|content-type" | sed 's/^/    /'

echo ""
SAMPLE=$(curl -s -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/ | head -c 300)
case "$SAMPLE" in
  *'<!DOCTYPE'*|*'<!doctype'*|*'<html'*)
    echo "  ✓✓✓ SUCCESS: / returns HTML — frontend reached via nginx"
    echo "       Open https://$DOMAIN/login in Chrome, Edge, and mobile to confirm."
    ;;
  *'"NOT_FOUND"'*|*'"success":false'*)
    echo "  ✗✗✗ STILL BROKEN: / returns backend JSON 404"
    echo ""
    echo "  Diagnostics:"
    echo "    PM2 frontend status:"
    pm2 describe crm-frontend 2>&1 | grep -E "status|script|cwd" | head -10 | sed 's/^/      /'
    echo ""
    echo "    Last 15 lines of frontend log:"
    pm2 logs crm-frontend --lines 15 --nostream 2>&1 | tail -15 | sed 's/^/      /'
    echo ""
    echo "    Active nginx config for /:"
    nginx -T 2>/dev/null | awk '/server_name '"$DOMAIN"'/,/^}/' | grep -A2 "location /" | head -20 | sed 's/^/      /'
    ;;
  *)
    echo "  ?  Unexpected response from /:"
    echo "      $SAMPLE"
    ;;
esac

echo ""
echo "================================================================="
echo "  Done. URL: https://$DOMAIN/login"
echo ""
echo "  After deploy, FIRST visit in each browser may show old cache for"
echo "  one render — the inline cleanup script in <head> unregisters any"
echo "  stale service workers + clears CacheStorage, then subsequent loads"
echo "  hit fresh content. Hard refresh (Ctrl+F5 / Cmd+Shift+R) on first"
echo "  load eliminates the one-render lag."
echo ""
echo "  Logs:  pm2 logs crm-frontend --lines 30 / pm2 logs crm-backend"
echo "================================================================="
