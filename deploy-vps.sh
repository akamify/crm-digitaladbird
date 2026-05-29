#!/bin/bash
set -euo pipefail

DOMAIN="crm.digitaladbird.com"
APP_DIR="/opt/digitaladbird-crm"
DB_NAME="digitaladbird"
DB_USER="crmuser"
DB_PASS="CrmProd2024xSecure"

echo ""
echo "================================================================="
echo "  DigitalADbird CRM — Full Production Deployment"
echo "  Domain: $DOMAIN"
echo "================================================================="
echo ""

# ── 1. System Update ──
echo "[1/16] Updating system..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg2 lsb-release ca-certificates build-essential software-properties-common

# ── 2. Node.js 20 ──
echo "[2/16] Installing Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node $(node -v) | npm $(npm -v)"

# ── 3. PM2 ──
echo "[3/16] Installing PM2..."
npm install -g pm2 2>/dev/null
echo "  PM2 $(pm2 -v)"

# ── 4. PostgreSQL ──
echo "[4/16] Installing PostgreSQL..."
if ! command -v psql &>/dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - 2>/dev/null
  apt-get update -qq
  apt-get install -y -qq postgresql
fi
systemctl enable postgresql
systemctl start postgresql
echo "  $(psql --version)"

# ── 5. Database Setup ──
echo "[5/16] Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres createdb -O $DB_USER $DB_NAME
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;" 2>/dev/null || true
echo "  Database '$DB_NAME' ready"

# ── 6. Extract Project ──
echo "[6/16] Setting up application..."
mkdir -p $APP_DIR
cd /root
if [ -f crm-deploy.tar.gz ]; then
  tar -xzf crm-deploy.tar.gz -C $APP_DIR/
  echo "  Extracted from archive"
else
  echo "  ERROR: crm-deploy.tar.gz not found in /root/"
  echo "  Upload it first: scp crm-deploy.tar.gz root@187.127.170.240:/root/"
  exit 1
fi

# ── 7. Generate Secrets & Backend .env ──
echo "[7/16] Creating backend .env..."
JWT_ACCESS=$(openssl rand -hex 64)
JWT_REFRESH=$(openssl rand -hex 64)
META_VERIFY=$(openssl rand -hex 32)

cat > $APP_DIR/backend/.env << ENVEOF
NODE_ENV=production
PORT=4000
APP_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN

DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
DB_SSL=false
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT=15000

JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30

OTP_PROVIDER=console
OTP_LENGTH=6
OTP_TTL_SECONDS=300
OTP_MAX_ATTEMPTS=5
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=
MSG91_SENDER_ID=OTPSMS
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
FAST2SMS_API_KEY=

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

LEAD_LOCK_MINUTES=10
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

GOOGLE_SHEET_ID=1kRY_XL7hTJfZng8fvo_nsSD43DijeynmUWr-nhL-1O4
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json
GOOGLE_SERVICE_ACCOUNT_KEY=
GOOGLE_SERVICE_ACCOUNT_EMAIL=digitaladbird-crm2@my-project-2-496806.iam.gserviceaccount.com
GOOGLE_SHEET_NAME=Sheet1

LOG_LEVEL=info
ENVEOF
echo "  Backend .env created"

# ── 8. Frontend .env ──
echo "[8/16] Creating frontend .env..."
cat > $APP_DIR/frontend/.env.local << 'FEOF'
NEXT_PUBLIC_API_URL=/api
FEOF
cat > $APP_DIR/frontend/.env.production << 'FEOF2'
NEXT_PUBLIC_API_URL=/api
FEOF2
echo "  Frontend .env created"

# ── 9. Install Backend Dependencies ──
echo "[9/16] Installing backend dependencies (this takes 1-2 min)..."
cd $APP_DIR/backend
npm install --omit=dev --ignore-scripts 2>&1 | tail -3
echo "  Backend deps installed"

# ── 10. Install Frontend Dependencies ──
echo "[10/16] Installing frontend dependencies (this takes 2-3 min)..."
cd $APP_DIR/frontend
npm install 2>&1 | tail -3
echo "  Frontend deps installed"

# ── 11. Run Migrations ──
echo "[11/16] Running database migrations..."
cd $APP_DIR/backend
node src/db/migrate.js
echo "  Migrations complete"

# ── 12. Seed Users ──
echo "[12/16] Seeding production users..."
cd $APP_DIR/backend
node src/db/seeds/seed_production_users.js 2>/dev/null && echo "  Users seeded" || echo "  Seed skipped (may already exist)"

# ── 13. Build Frontend (standalone) ──
echo "[13/16] Building Next.js frontend in standalone mode (3-5 min)..."
cd $APP_DIR/frontend
NODE_ENV=production npx next build 2>&1 | tail -10
# Standalone mode produces .next/standalone/server.js but does NOT bundle
# the static assets or the public/ folder — copy them in manually so the
# self-contained server can serve them.
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public || true
echo "  Frontend built (standalone: .next/standalone/server.js)"

# ── 14. PM2 Setup ──
echo "[14/16] Configuring PM2..."
mkdir -p /var/log/crm

cat > $APP_DIR/ecosystem.config.js << 'PM2EOF'
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      cwd: '/opt/digitaladbird-crm/backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
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
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0'
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

pm2 delete all 2>/dev/null || true
cd $APP_DIR
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
echo "  PM2 started"

# ── 15. Nginx ──
echo "[15/16] Configuring Nginx..."
apt-get install -y -qq nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/$DOMAIN << 'NGEOF'
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=webhooks:10m rate=50r/s;

server {
    listen 80;
    server_name crm.digitaladbird.com;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    client_max_body_size 10M;

    location /health {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

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

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public";
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

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
}
NGEOF

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl enable nginx
echo "  Nginx configured"

# ── 16. Firewall & SSL ──
echo "[16/16] Firewall + SSL..."
ufw allow 22/tcp >/dev/null 2>&1
ufw allow 80/tcp >/dev/null 2>&1
ufw allow 443/tcp >/dev/null 2>&1
echo "y" | ufw enable 2>/dev/null || true

echo "  Requesting SSL certificate..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email anshusingh00108@gmail.com --redirect 2>&1 || \
  echo "  SSL failed — check DNS A record points to this server IP"

# ── VERIFY ──
echo ""
echo "================================================================="
echo "  VERIFYING DEPLOYMENT..."
echo "================================================================="
sleep 5

echo ""
echo "PostgreSQL:"
sudo -u postgres psql -d $DB_NAME -tc "SELECT COUNT(*) FROM users;" 2>/dev/null | xargs echo "  Users in DB:"

echo ""
echo "PM2:"
pm2 list

echo ""
echo "Backend health:"
curl -sf http://localhost:4000/health && echo "" || echo "  Backend NOT responding"

echo ""
echo "Frontend:"
curl -so /dev/null -w "  HTTP %{http_code}\n" http://localhost:3000/ || echo "  Frontend NOT responding"

echo ""
echo "================================================================="
echo "  DEPLOYMENT COMPLETE"
echo ""
echo "  Live URL:   https://$DOMAIN"
echo "  Login:      https://$DOMAIN/login"
echo "  API:        https://$DOMAIN/api"
echo "  Webhooks:   https://$DOMAIN/webhooks/meta"
echo "  Health:     https://$DOMAIN/health"
echo ""
echo "  PM2 logs:   pm2 logs"
echo "  PM2 status: pm2 status"
echo "  App dir:    $APP_DIR"
echo "================================================================="
