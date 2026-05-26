#!/bin/bash
# ============================================================
# DigitalADbird CRM — Full Deployment Script for Hostinger VPS
# ============================================================
# Usage:
#   First time:  sudo bash scripts/deploy.sh --setup
#   Updates:     bash scripts/deploy.sh
# ============================================================
set -euo pipefail

APP_DIR="/var/www/digitaladbird-crm"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETUP_MODE=false

if [[ "${1:-}" == "--setup" ]]; then
  SETUP_MODE=true
fi

echo "╔══════════════════════════════════════════╗"
echo "║   DigitalADbird CRM — Deployment         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── First-time setup ─────────────────────────────────────────
if $SETUP_MODE; then
  echo "=== FIRST-TIME SETUP ==="
  echo ""

  # 1. System packages
  echo "[1/8] Installing system packages..."
  apt-get update -qq
  apt-get install -y curl git nginx certbot python3-certbot-nginx

  # 2. Node.js 20 LTS
  if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1)" < "v20" ]]; then
    echo "[2/8] Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    echo "[2/8] Node.js already installed: $(node -v)"
  fi

  # 3. PM2
  if ! command -v pm2 &>/dev/null; then
    echo "[3/8] Installing PM2..."
    npm install -g pm2
  else
    echo "[3/8] PM2 already installed: $(pm2 -v)"
  fi

  # 4. PostgreSQL
  echo "[4/8] Setting up PostgreSQL..."
  bash "${REPO_DIR}/scripts/setup-db.sh"

  # 5. Create app directory
  echo "[5/8] Creating app directory..."
  mkdir -p "$APP_DIR"
  mkdir -p /var/log/pm2
  mkdir -p /var/www/certbot

  # 6. Copy project files
  echo "[6/8] Copying project files..."
  rsync -av --exclude='node_modules' --exclude='.next' --exclude='backend/data' \
    --exclude='.env' --exclude='.env.local' \
    "${REPO_DIR}/" "$APP_DIR/"

  # 7. Nginx config
  echo "[7/8] Configuring Nginx..."
  cp "$APP_DIR/nginx/crm.conf" /etc/nginx/sites-available/crm.conf
  ln -sf /etc/nginx/sites-available/crm.conf /etc/nginx/sites-enabled/crm.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  echo "[8/8] Setup complete!"
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  NEXT STEPS:                                             ║"
  echo "║                                                          ║"
  echo "║  1. Copy backend/.env.production to backend/.env         ║"
  echo "║     and fill in the real values (DATABASE_URL, JWT, etc) ║"
  echo "║                                                          ║"
  echo "║  2. Copy Google credentials file to:                     ║"
  echo "║     $APP_DIR/backend/credentials/google-service-account.json ║"
  echo "║                                                          ║"
  echo "║  3. Point DNS: crm.digitaladbird.com → VPS IP            ║"
  echo "║                                                          ║"
  echo "║  4. Get SSL cert:                                        ║"
  echo "║     sudo certbot --nginx -d crm.digitaladbird.com        ║"
  echo "║                                                          ║"
  echo "║  5. Run the deploy again (without --setup):              ║"
  echo "║     bash scripts/deploy.sh                               ║"
  echo "║                                                          ║"
  echo "║  6. Update Meta webhook URL to:                          ║"
  echo "║     https://crm.digitaladbird.com/webhooks/meta           ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 0
fi

# ─── Normal deployment (update + restart) ──────────────────────
echo "[1/6] Syncing project files..."
rsync -av --exclude='node_modules' --exclude='.next' --exclude='backend/data' \
  --exclude='.env' --exclude='.env.local' --exclude='backend/credentials' \
  "${REPO_DIR}/" "$APP_DIR/"

echo "[2/6] Installing backend dependencies..."
cd "$APP_DIR/backend"
npm ci --omit=dev --ignore-scripts

echo "[3/6] Running database migrations..."
node src/db/migrate.js

echo "[4/6] Installing frontend dependencies & building..."
cd "$APP_DIR/frontend"
npm ci --omit=dev
npm run build

echo "[5/6] Restarting PM2 processes..."
cd "$APP_DIR"
pm2 startOrRestart ecosystem.config.js --env production
pm2 save

echo "[6/6] Reloading Nginx..."
cp "$APP_DIR/nginx/crm.conf" /etc/nginx/sites-available/crm.conf
nginx -t && systemctl reload nginx

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Deployment Complete!                    ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Status:"
pm2 status
echo ""
echo "Health check:"
sleep 3
curl -sf http://localhost:4000/health && echo " ← Backend OK" || echo " ← Backend not ready yet"
curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 && echo " ← Frontend OK" || echo " ← Frontend not ready yet"
