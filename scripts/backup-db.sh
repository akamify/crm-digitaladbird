#!/bin/bash
# ============================================================
# DigitalADbird CRM — PostgreSQL Backup Script
# Run daily via cron: 0 2 * * * /var/www/digitaladbird-crm/scripts/backup-db.sh
# ============================================================
set -euo pipefail

DB_NAME="${DB_NAME:-digitaladbird}"
DB_USER="${DB_USER:-crmuser}"
BACKUP_DIR="/var/backups/digitaladbird"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[backup] Starting PostgreSQL backup: $DB_NAME → $BACKUP_FILE"

pg_dump -U "$DB_USER" -h localhost "$DB_NAME" \
  --no-owner --no-privileges --if-exists --clean \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[backup] Backup complete: $BACKUP_FILE ($SIZE)"

# Remove old backups
echo "[backup] Cleaning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

REMAINING=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
echo "[backup] Done. $REMAINING backup(s) retained."
