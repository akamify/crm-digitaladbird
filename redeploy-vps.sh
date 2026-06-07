#!/usr/bin/env bash
###############################################################################
# DigitalADbird CRM — VPS redeploy (live "two-clone" layout)
#
# This production box serves the app from TWO separate git clones of this repo:
#   - Backend : /root/crm-digitaladbird   (PM2: digital-adbird-crm-backend, :4000)
#   - Frontend: /root/crm-frontend        (PM2: crm-frontend, `next start`, :3000)
# Both track origin/main on GitHub. This script updates BOTH clones, runs DB
# migrations, rebuilds the frontend, and restarts the two PM2 processes.
#
# Safety design:
#   * Backs up backend/.env, frontend env, and the DB (pg_dump) BEFORE touching code.
#   * Builds BEFORE any restart — a failed build leaves the live site untouched.
#   * Aborts the frontend build if NEXT_PUBLIC_API_URL is missing (a build without
#     it returns HTTP 200 but every browser API call breaks).
#   * Fails fast on a git auth prompt instead of hanging.
#
# Usage (on the VPS, as root):
#   bash /root/crm-digitaladbird/redeploy-vps.sh
#
# Self-update this script first, then run it:
#   cd /root/crm-digitaladbird && git fetch origin \
#     && git checkout origin/main -- redeploy-vps.sh && bash redeploy-vps.sh
#
# Override the layout if paths/process names differ:
#   BE=/path/be FE=/path/fe BE_PM2=name FE_PM2=name bash redeploy-vps.sh
#
# Rollback (note: a git reset does NOT undo DB migrations — restore the pg_dump):
#   cd /root/crm-digitaladbird && git reset --hard <OLD_SHA> \
#     && cp /root/backend.env.live backend/.env \
#     && cd backend && npm install --omit=dev --ignore-scripts && cd ..
#   cd /root/crm-frontend/frontend && git reset --hard <OLD_SHA> && npm install && npm run build
#   pm2 restart digital-adbird-crm-backend crm-frontend --update-env
###############################################################################
set -uo pipefail
export GIT_TERMINAL_PROMPT=0                  # never hang on a credential prompt

BE="${BE:-/root/crm-digitaladbird}"           # backend clone  -> pm2 digital-adbird-crm-backend
FE="${FE:-/root/crm-frontend}"                # frontend clone -> pm2 crm-frontend (next start)
BE_PM2="${BE_PM2:-digital-adbird-crm-backend}"
FE_PM2="${FE_PM2:-crm-frontend}"

echo "=== DEPLOY START: $(date) ==="

echo "== [1/9] Back up backend/.env =="
[ -f "$BE/backend/.env" ] || { echo "FATAL: $BE/backend/.env missing"; exit 1; }
cp "$BE/backend/.env" /root/backend.env.live && echo "  -> /root/backend.env.live"

echo "== [2/9] Back up frontend env =="
cp "$FE/frontend/.env.production" /root/fe.env.production.live 2>/dev/null && echo "  saved .env.production" || echo "  (none)"
cp "$FE/frontend/.env.local"      /root/fe.env.local.live      2>/dev/null && echo "  saved .env.local"      || echo "  (none)"

echo "== [3/9] Back up database (best-effort) =="
DBURL=$(grep '^DATABASE_URL=' "$BE/backend/.env" | head -1 | cut -d= -f2- | tr -d '\042\047')
TS=$(date +%Y%m%d-%H%M%S)
if [ -n "$DBURL" ] && command -v pg_dump >/dev/null 2>&1; then
  if pg_dump "$DBURL" > "/root/crm-db-$TS.sql" 2>"/root/crm-db-$TS.err"; then
    echo "  -> /root/crm-db-$TS.sql ($(wc -c < /root/crm-db-$TS.sql) bytes)"
  else echo "  WARN: pg_dump failed (see /root/crm-db-$TS.err) — continuing"; fi
else echo "  WARN: no DATABASE_URL or pg_dump missing — skipping"; fi

echo "== [4/9] Backend: fetch + reset to origin/main =="
cd "$BE" || { echo "FATAL: $BE missing"; exit 1; }
git sparse-checkout disable 2>/dev/null || true
git fetch origin --prune || { echo "FATAL: backend git fetch failed — nothing changed"; exit 1; }
git reset --hard origin/main || { echo "FATAL: backend git reset failed"; exit 1; }
cp /root/backend.env.live backend/.env
echo "  backend -> $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
cd "$BE/backend"
npm install --omit=dev --ignore-scripts --no-audit --no-fund || { echo "FATAL: backend npm install failed"; exit 1; }

echo "== [5/9] Frontend: fetch + reset to origin/main =="
cd "$FE" || { echo "FATAL: $FE missing"; exit 1; }
git sparse-checkout disable 2>/dev/null || true
git fetch origin --prune || { echo "FATAL: frontend git fetch failed — nothing restarted"; exit 1; }
git reset --hard origin/main || { echo "FATAL: frontend git reset failed"; exit 1; }
[ -f frontend/.env.production ] || cp /root/fe.env.production.live frontend/.env.production 2>/dev/null || true
[ -f frontend/.env.local ]      || cp /root/fe.env.local.live      frontend/.env.local      2>/dev/null || true
echo "  frontend -> $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
echo "  env: $(grep -h NEXT_PUBLIC_API_URL frontend/.env.production frontend/.env.local 2>/dev/null | head -1)"

echo "== [6/9] Frontend: deps + build =="
cd "$FE/frontend"
grep -q NEXT_PUBLIC_API_URL .env.production .env.local 2>/dev/null || { echo "FATAL: NEXT_PUBLIC_API_URL missing — build would ship broken API calls"; exit 1; }
npm install --no-audit --no-fund || { echo "FATAL: frontend npm install failed"; exit 1; }
npm run build || { echo "FATAL: frontend build failed — nothing restarted, live site intact"; exit 1; }

echo "== [7/9] DB migrations =="
cd "$BE/backend"
node src/db/migrate.js || { echo "FATAL: migration failed — NOT restarting (old code still serving)"; exit 1; }

echo "== [8/9] Restart PM2 =="
pm2 restart "$BE_PM2" --update-env || { echo "FATAL: backend restart failed"; exit 1; }
pm2 restart "$FE_PM2" --update-env || { echo "FATAL: frontend restart failed"; exit 1; }
pm2 save

echo "== [9/9] Verify =="
sleep 4
pm2 list
printf "backend  :4000/health -> "; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 6 http://127.0.0.1:4000/health
printf "frontend :3000/       -> "; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 6 http://127.0.0.1:3000/
printf "public   /health      -> "; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 https://crm.digitaladbird.com/health
echo "=== DONE: backend $(git -C "$BE" rev-parse --short HEAD) / frontend $(git -C "$FE" rev-parse --short HEAD) ==="
