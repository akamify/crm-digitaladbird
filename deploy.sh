#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# DigitalADbird CRM — Full Production Deployment Script
# Target: Hostinger VPS (Ubuntu/Debian)
# Domain: crm.digitaladbird.com
# ═══════════════════════════════════════════════════════════════

DOMAIN="crm.digitaladbird.com"
APP_DIR="/opt/digitaladbird-crm"
DB_NAME="digitaladbird"
DB_USER="crmuser"
DB_PASS="CrmProd2024@Secure"
NODE_VERSION="20"

echo "═══════════════════════════════════════════════════════"
echo "  DigitalADbird CRM — Production Deployment"
echo "  Domain: $DOMAIN"
echo "═══════════════════════════════════════════════════════"

# ── Step 1: System Update & Dependencies ──
echo -e "\n[1/15] Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "[1/15] Installing essential packages..."
apt-get install -y -qq curl wget git nginx certbot python3-certbot-nginx \
  build-essential software-properties-common ufw gnupg2 lsb-release

# ── Step 2: Install Node.js 20 ──
echo -e "\n[2/15] Installing Node.js $NODE_VERSION..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt $NODE_VERSION ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v) | npm: $(npm -v)"

# Install PM2 globally
echo "[2/15] Installing PM2..."
npm install -g pm2 2>/dev/null || true
echo "  PM2: $(pm2 -v)"

# ── Step 3: Install PostgreSQL 16 ──
echo -e "\n[3/15] Installing PostgreSQL..."
if ! command -v psql &>/dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  wget -qO - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - 2>/dev/null
  apt-get update -qq
  apt-get install -y -qq postgresql-16
fi
systemctl enable postgresql
systemctl start postgresql
echo "  PostgreSQL: $(psql --version)"

# ── Step 4: Setup Database ──
echo -e "\n[4/15] Configuring PostgreSQL database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres createdb -O $DB_USER $DB_NAME

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;"
sudo -u postgres psql -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"
echo "  Database '$DB_NAME' ready with user '$DB_USER'"

# ── Step 5: Create Application Directory ──
echo -e "\n[5/15] Setting up application directory..."
mkdir -p $APP_DIR

# ── Step 6: Generate Secrets ──
echo -e "\n[6/15] Generating JWT secrets..."
JWT_ACCESS=$(openssl rand -hex 64)
JWT_REFRESH=$(openssl rand -hex 64)
META_VERIFY=$(openssl rand -hex 32)

# ── Step 7: Create Backend .env ──
echo -e "\n[7/15] Creating backend environment file..."
cat > $APP_DIR/backend/.env << ENVEOF
NODE_ENV=production
PORT=4000
APP_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN

# Database
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
DB_SSL=false
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT=15000

# JWT
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30

# OTP
OTP_PROVIDER=console
OTP_LENGTH=6
OTP_TTL_SECONDS=300
OTP_MAX_ATTEMPTS=5

# MSG91
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=
MSG91_SENDER_ID=OTPSMS

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# Fast2SMS
FAST2SMS_API_KEY=

# Meta (Facebook) Lead Ads
META_APP_ID=
META_APP_SECRET=
META_USER_ACCESS_TOKEN=
META_PAGE_ACCESS_TOKEN=
META_PAGE_ID=220342467819979
META_PAGE_NAME=Digital AdBird
META_AD_ACCOUNT_IDS=act_4427126714020065,act_5090581587834677
META_FORM_ID=120234965746240243
META_VERIFY_TOKEN=$META_VERIFY
META_GRAPH_VERSION=v21.0

# Lead lock
LEAD_LOCK_MINUTES=10

# Rate limit
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

# Google Sheets
GOOGLE_SHEET_ID=1kRY_XL7hTJfZng8fvo_nsSD43DijeynmUWr-nhL-1O4
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json
GOOGLE_SERVICE_ACCOUNT_KEY=
GOOGLE_SERVICE_ACCOUNT_EMAIL=digitaladbird-crm2@my-project-2-496806.iam.gserviceaccount.com
GOOGLE_SHEET_NAME=Sheet1

LOG_LEVEL=info
ENVEOF

# ── Step 8: Create Frontend .env ──
echo -e "\n[8/15] Creating frontend environment file..."
cat > $APP_DIR/frontend/.env.production << FENVEOF
NEXT_PUBLIC_API_URL=/api
FENVEOF

cat > $APP_DIR/frontend/.env.local << FLENVEOF
NEXT_PUBLIC_API_URL=/api
FLENVEOF

# ── Step 9: Install Dependencies ──
echo -e "\n[9/15] Installing backend dependencies..."
cd $APP_DIR/backend
npm ci --production --ignore-scripts 2>/dev/null || npm install --production 2>/dev/null || npm install

echo "[9/15] Installing frontend dependencies..."
cd $APP_DIR/frontend
npm ci 2>/dev/null || npm install

# ── Step 10: Run Database Migrations ──
echo -e "\n[10/15] Running database migrations..."
cd $APP_DIR/backend
node src/db/migrate.js

# ── Step 11: Seed Production Users ──
echo -e "\n[11/15] Seeding production users..."
node src/db/seeds/seed_production_users.js 2>/dev/null || echo "  Seed script not found or already seeded"

# ── Step 12: Build Frontend ──
echo -e "\n[12/15] Building Next.js frontend (this takes a few minutes)..."
cd $APP_DIR/frontend
NODE_ENV=production npm run build

# ── Step 13: Configure PM2 ──
echo -e "\n[13/15] Configuring PM2 process manager..."
cat > $APP_DIR/ecosystem.config.js << 'PM2EOF'
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      cwd: '/opt/digitaladbird-crm/backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      max_memory_restart: '512M',
      error_file: '/var/log/crm/backend-error.log',
      out_file: '/var/log/crm/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
    },
    {
      name: 'crm-frontend',
      cwd: '/opt/digitaladbird-crm/frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      max_memory_restart: '512M',
      error_file: '/var/log/crm/frontend-error.log',
      out_file: '/var/log/crm/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
    }
  ]
};
PM2EOF

mkdir -p /var/log/crm

# Stop existing processes
pm2 delete all 2>/dev/null || true

# Start with ecosystem file
cd $APP_DIR
pm2 start ecosystem.config.js

# Save PM2 process list and enable startup on boot
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "  PM2 processes started"

# ── Step 14: Configure Nginx ──
echo -e "\n[14/15] Configuring Nginx reverse proxy..."
cat > /etc/nginx/sites-available/crm.digitaladbird.com << 'NGINXEOF'
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=webhooks:10m rate=50r/s;

server {
    listen 80;
    server_name crm.digitaladbird.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # Client body size (for file uploads)
    client_max_body_size 10M;

    # Health check (no proxy)
    location /health {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

    # Backend API
    location /api/ {
        limit_req zone=api burst=60 nodelay;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Meta/Facebook webhooks (must be fast and reliable)
    location /webhooks/ {
        limit_req zone=webhooks burst=100 nodelay;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    # Socket.IO WebSocket (chat real-time)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Chat file uploads
    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public";
    }

    # Next.js frontend (catch-all)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }

    # Next.js static files (long cache)
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

# Enable site
ln -sf /etc/nginx/sites-available/crm.digitaladbird.com /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
nginx -t && systemctl reload nginx
echo "  Nginx configured and running"

# ── Step 15: Firewall & SSL ──
echo -e "\n[15/15] Configuring firewall and SSL..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[15/15] Obtaining SSL certificate from Let's Encrypt..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email anshusingh00108@gmail.com --redirect || \
  echo "  SSL setup failed — will retry after DNS propagation"

# ── Final Verification ──
echo -e "\n═══════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE — Verifying services..."
echo "═══════════════════════════════════════════════════════"

sleep 3

echo ""
echo "PostgreSQL:"
sudo -u postgres psql -d $DB_NAME -c "SELECT COUNT(*) as user_count FROM users;" 2>/dev/null || echo "  DB check skipped"

echo ""
echo "PM2 Processes:"
pm2 list

echo ""
echo "Nginx Status:"
systemctl is-active nginx && echo "  Nginx: running" || echo "  Nginx: NOT running"

echo ""
echo "Backend Health:"
curl -s http://localhost:4000/health || echo "  Backend not responding"

echo ""
echo "Frontend:"
curl -s -o /dev/null -w "  Status: %{http_code}" http://localhost:3000 || echo "  Frontend not responding"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ★ CRM DEPLOYED: https://crm.digitaladbird.com ★"
echo ""
echo "  Frontend:   https://crm.digitaladbird.com"
echo "  Backend:    https://crm.digitaladbird.com/api"
echo "  Webhooks:   https://crm.digitaladbird.com/webhooks/meta"
echo "  Health:     https://crm.digitaladbird.com/health"
echo ""
echo "  PM2 Logs:   pm2 logs"
echo "  PM2 Status: pm2 status"
echo "  App Dir:    $APP_DIR"
echo "═══════════════════════════════════════════════════════"
