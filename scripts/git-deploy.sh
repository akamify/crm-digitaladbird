#!/bin/bash
# ============================================================
# DigitalADbird CRM — Git-based VPS Deploy
# ============================================================
# Workflow:
#   1. Local: `git push` to your repo
#   2. VPS:   `bash /opt/digitaladbird-crm/scripts/git-deploy.sh`
#
# This script pulls the latest code, rebuilds backend + frontend,
# hard-resets PM2 (so script/env changes apply), reconfigures
# Nginx, and verifies everything end-to-end.
#
# First-time setup on the VPS — make /opt/digitaladbird-crm a
# git checkout (one-time):
#   cd /opt
#   mv digitaladbird-crm digitaladbird-crm.bak
#   git clone <REPO_URL> digitaladbird-crm
#   # restore .env files
#   cp digitaladbird-crm.bak/backend/.env digitaladbird-crm/backend/.env
#   cp digitaladbird-crm.bak/frontend/.env.local digitaladbird-crm/frontend/.env.local
#   cp digitaladbird-crm.bak/frontend/.env.production digitaladbird-crm/frontend/.env.production
#   bash digitaladbird-crm/scripts/git-deploy.sh
# ============================================================
set -euo pipefail

DOMAIN="crm.digitaladbird.com"
APP_DIR="/opt/digitaladbird-crm"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"
EMAIL="anshusingh00108@gmail.com"

echo "================================================================="
echo "  DigitalADbird CRM — Git Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================="

# ── Pre-flight ────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
[ -d "$APP_DIR" ]    || { echo "Missing $APP_DIR — clone the repo first."; exit 1; }
command -v node  >/dev/null || { echo "node not installed"; exit 1; }
command -v pm2   >/dev/null || npm install -g pm2
command -v nginx >/dev/null || apt-get install -y -qq nginx

cd "$APP_DIR"

# ── 1. Pull latest code ───────────────────────────────────────
echo ""
echo "[1/7] git pull…"
if [ -d .git ]; then
  # Preserve any local-only files (e.g. .env not in repo)
  git fetch --all --prune
  CURRENT_SHA=$(git rev-parse HEAD)
  git reset --hard origin/main
  NEW_SHA=$(git rev-parse HEAD)
  if [ "$CURRENT_SHA" = "$NEW_SHA" ]; then
    echo "  Already at latest commit: $NEW_SHA"
  else
    echo "  Updated: $CURRENT_SHA → $NEW_SHA"
    git --no-pager log --oneline "$CURRENT_SHA..$NEW_SHA" | head -10
  fi
else
  echo "  WARN: $APP_DIR is not a git checkout. Skipping pull — code must be uploaded manually."
fi

# ── 2. Backend deps + migrations ──────────────────────────────
echo ""
echo "[2/7] Backend deps…"
cd "$BACKEND_DIR"
npm install --omit=dev --ignore-scripts 2>&1 | tail -3

echo "  Running migrations…"
node src/db/migrate.js 2>&1 | tail -5 || { echo "  Migration failed — check DB connection"; exit 1; }

# ── 3. Frontend build (standalone) ───────────────────────────
echo ""
echo "[3/7] Frontend deps + standalone build…"
cd "$FRONTEND_DIR"
npm install 2>&1 | tail -3
NODE_ENV=production npm run build 2>&1 | tail -15

# Verify the standalone server exists (requires output:'standalone' in next.config.js)
if [ ! -f .next/standalone/server.js ]; then
  echo "  ✗ ERROR: .next/standalone/server.js missing."
  echo "    Check next.config.js has: output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined"
  exit 1
fi

# Copy assets that Next.js standalone doesn't bundle automatically
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public || true
echo "  ✓ standalone server.js + static + public ready"

# ── 4. Nginx config (/ → 3000, /api → 4000) ───────────────────
echo ""
echo "[4/7] Nginx config…"

SSL_AVAILABLE=0
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  SSL_AVAILABLE=1
fi

CONF="/etc/nginx/sites-available/$DOMAIN"
cat > "$CONF" <<NGINX
# Managed by git-deploy.sh — do not hand-edit.
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=webhook_limit:10m rate=60r/s;

upstream crm_backend  { server 127.0.0.1:4000; keepalive 32; }
upstream crm_frontend { server 127.0.0.1:3000; keepalive 16; }

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
NGINX

if [ "$SSL_AVAILABLE" -eq 1 ]; then
  cat >> "$CONF" <<NGINX
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

NGINX
else
  echo "  (No SSL certs yet — serving HTTP only)"
fi

cat >> "$CONF" <<'NGINX'
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 10M;
    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

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
    location /_next/static/ {
        proxy_pass http://crm_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
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

echo "  Testing nginx config…"
nginx -t 2>&1 | tail -3

systemctl reload nginx
echo "  ✓ nginx reloaded"

# Auto-obtain SSL on first run
if [ "$SSL_AVAILABLE" -eq 0 ] && command -v certbot >/dev/null; then
  echo "  Attempting SSL via certbot…"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect 2>&1 | tail -5 || true
fi

# ── 5. PM2 — hard re-create so config changes apply ──────────
echo ""
echo "[5/7] PM2 hard re-create…"
mkdir -p /var/log/pm2 /var/log/crm

# CRITICAL: `pm2 reload` keeps the saved script/env — only delete+start
# fully refreshes when next.config.js / ecosystem.config.js changes.
pm2 delete crm-backend  2>/dev/null || true
pm2 delete crm-frontend 2>/dev/null || true

cd "$APP_DIR"
pm2 start ecosystem.config.js --update-env
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root 2>/dev/null || true

sleep 3
pm2 list

# ── 6. Loopback port checks ──────────────────────────────────
echo ""
echo "[6/7] Local port checks…"
BE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:4000/health || echo "000")
FE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/         || echo "000")
echo "  backend  :4000/health → HTTP $BE  (expect 200)"
echo "  frontend :3000/       → HTTP $FE  (expect 200/307)"

if [ "$BE" != "200" ]; then
  echo "  ✗ backend not responding:"
  pm2 logs crm-backend --lines 20 --nostream 2>&1 | tail -20
fi
if [ "$FE" != "200" ] && [ "$FE" != "307" ] && [ "$FE" != "308" ]; then
  echo "  ✗ frontend not responding:"
  pm2 logs crm-frontend --lines 20 --nostream 2>&1 | tail -20
fi

# ── 7. End-to-end via Nginx ──────────────────────────────────
echo ""
echo "[7/7] End-to-end check via $DOMAIN…"
ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/         || echo "000")
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/login  || echo "000")
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/health || echo "000")
echo "  /        → HTTP $ROOT_CODE"
echo "  /login   → HTTP $LOGIN_CODE"
echo "  /health  → HTTP $HEALTH_CODE"

SAMPLE=$(curl -s -H "Host: $DOMAIN" --max-time 5 http://127.0.0.1/ | head -c 200)
case "$SAMPLE" in
  *'<!DOCTYPE'*|*'<!doctype'*|*'<html'*)
    echo "  ✓ / returns HTML (frontend reached via nginx)"
    ;;
  *'"NOT_FOUND"'*|*'"success":false'*)
    echo "  ✗ / still returns backend JSON 404"
    echo "  First 200 bytes of response:"
    echo "    $SAMPLE"
    ;;
  *)
    echo "  ?  / returned unexpected payload — first 200 bytes:"
    echo "    $SAMPLE"
    ;;
esac

echo ""
echo "================================================================="
echo "  DEPLOY COMPLETE"
echo ""
echo "  Live URL:    https://$DOMAIN/login"
echo "  Backend:     pm2 logs crm-backend --lines 30"
echo "  Frontend:    pm2 logs crm-frontend --lines 30"
echo "  Nginx logs:  tail -f /var/log/nginx/error.log"
echo "================================================================="
