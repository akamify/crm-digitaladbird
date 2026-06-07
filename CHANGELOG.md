# DigitalADbird CRM — Changelog

## v1.1.0 — 2026-06-07 (current)

Single consolidated deployment marker covering **all features across 48 commits**.
Deployment target: `crm.digitaladbird.com` (Hostinger VPS, Ubuntu 24.04).

To deploy this version on VPS:
```bash
ssh root@<vps>
cd /root/crm-digitaladbird
bash scripts/vps-sync-from-local.sh
```

---

### Backend features (all in HEAD)

#### Lead distribution + assignment
- Today-first ORDER BY at 3 sites — POST /lead-requests, approve handler, scheduler
- Status invariant — only mark `fulfilled` when `leads_assigned >= quantity`
- Auto-fulfill on new lead arrival (instant top-up of pending requests)
- Auto-distribution window 8 AM – 7 PM IST
- Request engine fixes: never mark fulfilled with delivered=0
- Manual approve remains as fallback

#### Meta integration
- Webhook receiver at `/webhooks/meta` + alias `/webhook`
- Auto-register unknown form_id (no FK violations on new forms)
- Lead recovery script (`recover-meta-leads.js`) — backfill from Meta Graph API
- HOURS_BACK=0 = all-time backfill mode
- Auto-discover forms + fix `meta_forms.deleted_at` query bug
- Structured webhook logging with step-by-step trace
- Meta config seed: 6 pages, 4 forms, 4 campaigns (`db/seeds/meta-config-seed.sql`)

#### Dashboard + counters
- Cache-bust on lead insert (`bustLeadCountersCache` in middleware/cache.js)
- Dashboard uses Meta lead timestamp, not DB insert time
- IST-explicit date math (Asia/Kolkata) — independent of DB timezone
- Process + DB session pinned to Asia/Kolkata
- 30-day dedup window for Meta leads
- Live socket invalidation on counter change
- Role-scoped endpoints (admin sees all, RM sees team, partner sees own)

#### Audit + activity logs
- Migrations 031 + 032: extended activity_logs schema + session activity
- Rich device parsing (UA, IP, geo)
- Failed-login audit tracking (4 reason codes)
- New-device / multi-session signals
- Session-linkage via auth_sessions.id

#### Stability + diagnostics
- `/health/db-strict` endpoint (real_pg + users count)
- Migration 030: IST timezone pin
- Lead validator (`leadValidator.js`) — reject fake/test/invalid leads at ingest
- Per-tab session isolation (sessionStorage instead of localStorage)
- Refresh-token rotation
- JWT-aware role probe

### Frontend features (all in HEAD)

#### Brand identity
- Custom Bird logo (`BirdLogo.tsx` + `BirdMark` + `LogoLockup`)
- Custom Raccoon mascot (`RaccoonMascot.tsx`)
- Custom favicon.svg + apple-touch-icon.svg
- PWA manifest (`manifest.webmanifest`) with theme_color brand blue
- Layout metadata: icons + manifest registered
- No stock assets — every glyph hand-authored SVG

#### UI / responsive
- Gradient sidebar active state
- Larger KPIs on dashboard
- Modern table utilities
- Sharper Meta Page cards
- Defensive overflow guards
- Mobile-tightened Topbar / KpiCard / Modal
- Activity Logs page with rich audit-trail view
- Workflow Step 3: unlock Step 4 on any follow-up selection
- Step 4 attachments support

#### Real-time
- Socket.IO wired for live lead-counter updates
- Live socket invalidation
- React Query auto-refetch on lead:new event

### Deployment + ops scripts (all in repo)

| Script | Purpose |
|---|---|
| `scripts/vps-sync-from-local.sh` | **THE one-command VPS deploy** — pull, migrate, seed, restart, verify |
| `scripts/deploy-final.sh` | Comprehensive 8-layer deploy with assertions |
| `scripts/deploy-and-verify.sh` | Legacy deploy script |
| `scripts/diagnose-prod-zero.sh` | Why prod shows 0 leads |
| `scripts/diagnose-network.sh` | ERR_CONNECTION_TIMED_OUT root cause |
| `scripts/diagnose-fb-leads.sh` | Meta leads missing audit |
| `scripts/diagnose-500.sh` | Prod 500 error audit |
| `scripts/diagnose-login.sh` | Login failures audit |
| `scripts/audit-counts.sh` | Lead-counter parity check |
| `backend/scripts/verify-local.js` | 13-assertion contract test |
| `backend/scripts/audit-counts.js` | DB ↔ API parity for all dashboard endpoints |
| `backend/scripts/recover-meta-leads.js` | Backfill missed Meta leads from Graph API |
| `backend/scripts/simulate-meta-webhook.js` | Local webhook E2E simulator |
| `backend/scripts/diagnose-meta.js` | Graph API token/webhook health probe |
| `backend/scripts/export-meta-config.js` | Generate safe seed for VPS |
| `backend/.env.vps.template` | Production env template (no secrets) |
| `backend/src/db/seeds/meta-config-seed.sql` | 6 pages + 4 forms + 4 campaigns seed |

### Security

- `.env` added to `.gitignore` (was previously committed in 363ff04 / 1e41b2b)
- `backend/.env` untracked from git (kept on disk)
- VPS env template uses `<COPY_FROM_LOCAL>` placeholders (no plaintext secrets)
- Meta config seed excludes all token columns (NULL on import)
- Lead PII never enters git — `recover-meta-leads.js` pulls from Meta source

**Required by operator after deployment:**
1. Rotate `META_APP_SECRET` (Meta Dashboard → App Settings → Reset)
2. Rotate `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (regenerates with `openssl rand -hex 64`)
3. Generate System User Page Access Token (never expires) in Meta Business Suite
4. Make GitHub repo private (currently public — secrets in old commits exposed)

### Database migrations (all applied locally)

| # | File | Status |
|---|---|---|
| 028 | sheet_purpose | ✅ |
| 029 | payment_attachments | ✅ |
| 030 | timezone_ist | ✅ |
| 031 | activity_logs_extended | ✅ |
| 032 | session_activity | ✅ |

Total: 32/32 migrations applied.

### Localhost verification (passed 13/13)

```
✓ /health/db-strict real_pg=true
✓ DB timezone Asia/Calcutta
✓ live-stats.total_leads matches DB.total
✓ live-stats.today_leads matches DB.today
✓ distribution-stats.queued matches DB.queued
✓ Total Leads +1 immediately on insert (cache-bust)
✓ Today Leads +1 immediately on insert (cache-bust)
✓ POST /api/lead-requests → 200 + auto-fulfilled
✓ Today-first priority: today lead assigned, not older
✓ Zero fulfilled requests with leads_assigned < quantity
✓ ≥1 active meta_pages row
✓ ≥1 meta_forms row
✓ Socket.IO handshake OK
```

---

## v1.0.0 — earlier

Initial production rollout — per-tab session isolation, lead-level cleanup,
Step 4 attachments, fresh-leads endpoint, real-time wiring.
