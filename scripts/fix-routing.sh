#!/bin/bash
# ============================================================
# DigitalADbird CRM — Production Routing Fix
# ============================================================
# Purpose: ensure `/` serves the Next.js frontend and `/api`
# serves the Express backend on crm.digitaladbird.com.
#
# Run on the VPS as root:
#   bash /opt/digitaladbird-crm/scripts/fix-routing.sh
# ============================================================
set -euo pipefail

DOMAIN="crm.digitaladbird.com"
APP_DIR="/opt/digitaladbird-crm"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"
EMAIL="anshusingh00108@gmail.com"

echo "================================================================="
echo "  CRM Routing Fix — $DOMAIN"
echo "================================================================="

# ── 0. Sanity ──────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
[ -d "$APP_DIR" ]   || { echo "Missing $APP_DIR"; exit 1; }
[ -d "$FRONTEND_DIR" ] || { echo "Missing $FRONTEND_DIR"; exit 1; }
[ -d "$BACKEND_DIR" ]  || { echo "Missing $BACKEND_DIR"; exit 1; }

command -v node >/dev/null  || { echo "node not installed"; exit 1; }
command -v pm2  >/dev/null  || { npm install -g pm2; }
command -v nginx >/dev/null || { apt-get install -y -qq nginx; }

# ── 1. Frontend build ──────────────────────────────────────────
echo ""
echo "[1/6] Frontend build check…"
cd "$FRONTEND_DIR"

# Make sure the .env files exist with the expected API base
if [ ! -f .env.production ]; then
  cat > .env.production <<EOF
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_WS_URL=
EOF
  echo "  created .env.production"
fi
if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_WS_URL=
EOF
  echo "  created .env.local"
fi

NEED_BUILD=0
if [ ! -d .next ] || [ ! -f .next/BUILD_ID ]; then
  echo "  .next/ missing → will build"
  NEED_BUILD=1
fi

if [ ! -d node_modules ]; then
  echo "  installing frontend deps…"
  npm install 2>&1 | tail -3
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  echo "  running npm run build (3–5 min)…"
  NODE_ENV=production npm run build 2>&1 | tail -20
fi

# Verify build artifact exists now
[ -f .next/BUILD_ID ] || { echo "ERROR: frontend build failed — .next/BUILD_ID still missing"; exit 1; }

# Standalone server needs static + public copied in (Next.js doesn't bundle them).
if [ -f .next/standalone/server.js ]; then
  cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
  [ -d public ] && cp -r public .next/standalone/public 2>/dev/null || true
  echo "  ✓ frontend standalone server ready (.next/standalone/server.js)"
else
  echo "  ⚠ standalone server NOT found — next.config.js may be missing output: 'standalone'"
fi
echo "  ✓ frontend build present (BUILD_ID: $(cat .next/BUILD_ID))"

# ── 2. Backend deps ────────────────────────────────────────────
echo ""
echo "[2/6] Backend dependency check…"
cd "$BACKEND_DIR"
if [ ! -d node_modules ]; then
  npm install --omit=dev --ignore-scripts 2>&1 | tail -3
fi
echo "  ✓ backend deps present"

# ── 3. PM2 processes (both apps) ───────────────────────────────
echo ""
echo "[3/6] PM2 processes…"
mkdir -p /var/log/pm2

# Hard-replace PM2 entries — `pm2 reload` keeps the saved script/args, so a
# config change (next start → standalone) won't propagate without delete+start.
pm2 delete crm-backend  2>/dev/null || true
pm2 delete crm-frontend 2>/dev/null || true

if [ -f "$APP_DIR/ecosystem.config.js" ]; then
  pm2 start "$APP_DIR/ecosystem.config.js" --update-env
else
  pm2 start "$BACKEND_DIR/src/server.js" --name crm-backend  --cwd "$BACKEND_DIR"  -- --env NODE_ENV=production
  PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production \
    pm2 start "$FRONTEND_DIR/.next/standalone/server.js" --name crm-frontend --cwd "$FRONTEND_DIR" --update-env
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root 2>/dev/null || true

sleep 3
pm2 list

# ── 4. Sanity-check loopback ports ─────────────────────────────
echo ""
echo "[4/6] Local port checks…"
BE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health || echo "000")
FE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/         || echo "000")
echo "  backend  :4000/health → HTTP $BE_STATUS  (expect 200)"
echo "  frontend :3000/       → HTTP $FE_STATUS  (expect 200 or 307)"

if [ "$BE_STATUS" != "200" ]; then
  echo "  ✗ backend not responding — check: pm2 logs crm-backend --lines 50"
fi
if [ "$FE_STATUS" != "200" ] && [ "$FE_STATUS" != "307" ] && [ "$FE_STATUS" != "308" ]; then
  echo "  ✗ frontend not responding — check: pm2 logs crm-frontend --lines 50"
  echo "    (most common cause: build missing or :3000 already taken)"
fi

# ── 5. Nginx config — `/` → :3000, `/api` → :4000 ──────────────
echo ""
echo "[5/6] Writing canonical Nginx config…"

# Decide whether SSL certs already exist — write a config that includes
# the HTTPS server only if certbot has already populated certificates.
SSL_AVAILABLE=0
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] \
   && [ -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]; then
  SSL_AVAILABLE=1
fi

CONF="/etc/nginx/sites-available/$DOMAIN"
cat > "$CONF" <<NGINX
# Managed by fix-routing.sh — DO NOT hand-edit between runs.

limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=webhook_limit:10m rate=60r/s;

upstream crm_backend  { server 127.0.0.1:4000; keepalive 32; }
upstream crm_frontend { server 127.0.0.1:3000; keepalive 16; }

# ─── HTTP listener ───────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # ACME challenge for certbot
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

NGINX

if [ "$SSL_AVAILABLE" -eq 1 ]; then
  cat >> "$CONF" <<NGINX
    # SSL is configured below — redirect HTTP to HTTPS
    location / { return 301 https://\$host\$request_uri; }
}

# ─── HTTPS listener ──────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

NGINX
else
  echo "  (no SSL certs yet — serving HTTP only; rerun certbot when DNS is ready)"
fi

cat >> "$CONF" <<'NGINX'
    # ── Security headers ──
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 10M;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # ── Backend: webhooks, API, socket.io, uploads, health ──
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

    location /socket.io/ {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location /uploads/ {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
    }

    location /health {
        proxy_pass http://crm_backend;
        proxy_http_version 1.1;
        access_log off;
    }

    # ── Next.js static (long cache) ──
    location /_next/static/ {
        proxy_pass http://crm_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # ── Everything else → Next.js frontend ──
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
    }
}
NGINX

ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

echo "  testing nginx config…"
nginx -t

systemctl reload nginx
echo "  ✓ nginx reloaded"

# Try to get/renew the SSL cert if not present yet
if [ "$SSL_AVAILABLE" -eq 0 ] && command -v certbot >/dev/null; then
  echo "  attempting SSL via certbot (non-fatal if DNS not pointed yet)…"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect 2>&1 | tail -5 || true
fi

# ── 6. End-to-end verification ─────────────────────────────────
echo ""
echo "[6/6] End-to-end verification…"

LOCAL_API=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" "http://127.0.0.1/health"            || echo "000")
LOCAL_ROOT=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" "http://127.0.0.1/"                  || echo "000")
LOCAL_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" "http://127.0.0.1/login"            || echo "000")

echo "  via nginx /health → $LOCAL_API   (expect 200)"
echo "  via nginx /       → $LOCAL_ROOT  (expect 200, 301, 307, or 308)"
echo "  via nginx /login  → $LOCAL_LOGIN (expect 200)"

# Show what kind of payload `/` returns — we want HTML, not JSON
SAMPLE=$(curl -s -H "Host: $DOMAIN" "http://127.0.0.1/" | head -c 200)
case "$SAMPLE" in
  *'<!DOCTYPE'*|*'<!doctype'*|*'<html'*)
    echo "  ✓ / returns HTML (frontend reached)"
    ;;
  *'"NOT_FOUND"'*|*'"success":false'*)
    echo "  ✗ / still returns backend JSON 404 — check pm2 list & nginx -T | grep -A1 'location /'"
    ;;
  *)
    echo "  ?  / returned unexpected payload — first 200 bytes:"
    echo "     $SAMPLE"
    ;;
esac

echo ""
echo "================================================================="
echo "  Done. Open: https://$DOMAIN"
echo ""
echo "  Useful commands:"
echo "    pm2 list                       # check both apps are 'online'"
echo "    pm2 logs crm-frontend --lines 50"
echo "    pm2 logs crm-backend --lines 50"
echo "    nginx -T | sed -n '/server_name $DOMAIN/,/^}/p'"
echo "    curl -sI https://$DOMAIN/"
echo "================================================================="
