#!/bin/bash
# ============================================================
# DigitalADbird CRM — PostgreSQL Production Setup
# Run on Hostinger VPS as root or sudo user
# ============================================================
set -euo pipefail

DB_NAME="${DB_NAME:-digitaladbird}"
DB_USER="${DB_USER:-crmuser}"
DB_PASS="${DB_PASS:-}"

echo "=== DigitalADbird CRM — PostgreSQL Setup ==="
echo ""

# 1. Install PostgreSQL if not present
if ! command -v psql &>/dev/null; then
  echo "[1/6] Installing PostgreSQL..."
  apt-get update -qq
  apt-get install -y postgresql postgresql-contrib
else
  echo "[1/6] PostgreSQL already installed: $(psql --version)"
fi

# 2. Ensure PostgreSQL is running
echo "[2/6] Starting PostgreSQL service..."
systemctl enable postgresql
systemctl start postgresql

# 3. Generate password if not provided
if [ -z "$DB_PASS" ]; then
  DB_PASS=$(openssl rand -hex 16)
  echo ""
  echo "  ┌─────────────────────────────────────────┐"
  echo "  │  GENERATED DATABASE PASSWORD             │"
  echo "  │  $DB_PASS  │"
  echo "  │  Save this in backend/.env               │"
  echo "  └─────────────────────────────────────────┘"
  echo ""
fi

# 4. Create database user
echo "[3/6] Creating database user '$DB_USER'..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  && echo "  User '$DB_USER' already exists" \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

# 5. Create database
echo "[4/6] Creating database '$DB_NAME'..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  && echo "  Database '$DB_NAME' already exists" \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

# 6. Grant permissions
echo "[5/6] Granting permissions..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"

# 7. Configure pg_hba for local password auth
echo "[6/6] Verifying pg_hba.conf..."
PG_HBA=$(sudo -u postgres psql -tc "SHOW hba_file" | xargs)
if grep -q "local.*all.*${DB_USER}" "$PG_HBA" 2>/dev/null; then
  echo "  pg_hba.conf already configured"
else
  echo "  Adding local auth entry..."
  echo "local   $DB_NAME   $DB_USER   md5" | tee -a "$PG_HBA" >/dev/null
  echo "host    $DB_NAME   $DB_USER   127.0.0.1/32   md5" | tee -a "$PG_HBA" >/dev/null
  systemctl reload postgresql
fi

echo ""
echo "=== PostgreSQL Setup Complete ==="
echo ""
echo "Connection string for .env:"
echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
echo ""
echo "Next step: Run migrations"
echo "  cd /var/www/digitaladbird-crm/backend"
echo "  node src/db/migrate.js"
