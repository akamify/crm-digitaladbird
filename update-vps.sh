#!/bin/bash
set -euo pipefail

##############################################################
#  DigitalADbird CRM — UPDATE DEPLOYMENT (not full install)
#  Run this on the VPS after uploading crm-deploy.tar.gz
#
#  Usage:
#    scp crm-deploy.tar.gz root@YOUR_VPS_IP:/root/
#    scp update-vps.sh root@YOUR_VPS_IP:/root/
#    ssh root@YOUR_VPS_IP 'bash /root/update-vps.sh'
##############################################################

APP_DIR="/opt/digitaladbird-crm"

echo ""
echo "================================================================="
echo "  DigitalADbird CRM — Updating Backend + Frontend"
echo "================================================================="
echo ""

# ── 1. Stop PM2 apps ──
echo "[1/7] Stopping PM2 apps..."
pm2 stop all 2>/dev/null || true
echo "  PM2 stopped"

# ── 2. Backup current .env files ──
echo "[2/7] Backing up .env files..."
cp $APP_DIR/backend/.env /root/backend-env-backup 2>/dev/null || true
cp $APP_DIR/frontend/.env.local /root/frontend-env-backup 2>/dev/null || true
cp $APP_DIR/frontend/.env.production /root/frontend-env-production-backup 2>/dev/null || true
echo "  .env backed up to /root/"

# ── 3. Extract new code ──
echo "[3/7] Extracting new code..."
cd /root
if [ -f crm-deploy.tar.gz ]; then
  tar -xzf crm-deploy.tar.gz -C $APP_DIR/
  echo "  Code extracted to $APP_DIR"
else
  echo "  ERROR: crm-deploy.tar.gz not found in /root/"
  echo "  Upload it first: scp crm-deploy.tar.gz root@YOUR_VPS_IP:/root/"
  pm2 start all 2>/dev/null || true
  exit 1
fi

# ── 4. Restore .env files ──
echo "[4/7] Restoring .env files..."
cp /root/backend-env-backup $APP_DIR/backend/.env 2>/dev/null || true
cp /root/frontend-env-backup $APP_DIR/frontend/.env.local 2>/dev/null || true
cp /root/frontend-env-production-backup $APP_DIR/frontend/.env.production 2>/dev/null || true
echo "  .env restored"

# ── 5. Install deps + run migrations ──
echo "[5/7] Installing backend dependencies..."
cd $APP_DIR/backend
npm install --omit=dev --ignore-scripts 2>&1 | tail -3
echo "  Backend deps installed"

echo "[5/7] Running database migrations..."
node src/db/migrate.js
echo "  Migrations complete"

# ── 6. Build frontend ──
echo "[6/7] Installing frontend deps + building..."
cd $APP_DIR/frontend
npm install 2>&1 | tail -3
NODE_ENV=production npx next build 2>&1 | tail -10
echo "  Frontend built"

# ── 7. Restart PM2 ──
echo "[7/7] Restarting PM2..."
cd $APP_DIR
pm2 start ecosystem.config.js
pm2 save
echo "  PM2 restarted"

# ── VERIFY ──
echo ""
echo "================================================================="
echo "  VERIFYING..."
echo "================================================================="
sleep 5

echo ""
echo "PM2 status:"
pm2 list

echo ""
echo "Backend health:"
curl -sf http://localhost:4000/health && echo "" || echo "  Backend NOT responding"

echo ""
echo "Frontend:"
curl -so /dev/null -w "  HTTP %{http_code}\n" http://localhost:3000/ || echo "  Frontend NOT responding"

echo ""
echo "================================================================="
echo "  UPDATE COMPLETE!"
echo "  Live: https://crm.digitaladbird.com"
echo "================================================================="
