#!/bin/bash
# Probe every documented API route unauthenticated. Should all return 401 NO_TOKEN.
# Any 500/404 is a real bug — 401 is the gate working correctly.
B="http://127.0.0.1:4000/api"
NIL="00000000-0000-0000-0000-000000000000"

probe() {
  local method=$1 path=$2 status
  status=$(curl -s -o /tmp/r -w "%{http_code}" -X "$method" "$B$path")
  local err=$(cat /tmp/r 2>/dev/null | grep -oE '"code":"[^"]*"' | head -1)
  printf "  %-6s %-58s %s %s\n" "$method" "$path" "$status" "$err"
}

echo "================= AUTH =================="
probe GET    /auth/me
probe POST   /auth/login
probe POST   /auth/logout
probe POST   /auth/refresh

echo "================= ADMIN MODULE =================="
probe GET    /admin/leads/fresh
probe GET    /admin/live-stats
probe GET    /admin/active-members
probe GET    /admin/campaigns
probe GET    /admin/sheets/configs
probe GET    /admin/sheets/stats
probe GET    /admin/meta/pages-enriched
probe GET    /admin/meta/overview
probe GET    /admin/meta/forms-enriched
probe GET    /admin/meta/campaigns-enriched
probe GET    /admin/meta/subscription-status
probe GET    /admin/meta/token-status
probe GET    /admin/meta/webhook-logs
probe GET    /admin/followups
probe GET    /admin/unassigned-leads
probe GET    /admin/notifications
probe GET    /admin/activity-logs
probe GET    /admin/broadcast
probe POST   /admin/broadcast
probe POST   /admin/force-assign
probe POST   /admin/bulk-leads
probe GET    /admin/export/leads
probe GET    /admin/export/reports

echo "================= LEAD CRUD =================="
probe GET    /leads
probe GET    /leads/$NIL
probe POST   /leads
probe POST   /leads/$NIL/reassign

echo "================= LEAD REQUESTS =================="
probe GET    /lead-requests
probe GET    /lead-requests/my
probe GET    /lead-requests/stats
probe POST   /lead-requests
probe POST   /lead-requests/$NIL/approve
probe POST   /lead-requests/$NIL/reject

echo "================= RM =================="
probe GET    /rm-lead-requests
probe GET    /rm-monitoring/live-counters
probe GET    /rm-monitoring/team-overview
probe GET    /rm-monitoring/member-requests
probe GET    /rm-pool/leads
probe GET    /rm-pool/stats

echo "================= PARTNER =================="
probe GET    /partner-requests
probe GET    /partner-requests/stats/summary

echo "================= WORKFLOW =================="
probe GET    /workflow/stats
probe GET    /workflow/summary
probe GET    /leads/$NIL/workflow
probe GET    /leads/$NIL/workflow/history
probe GET    /leads/$NIL/workflow/conversion/attachments
probe POST   /leads/$NIL/workflow/conversion/attachments
probe POST   /leads/$NIL/workflow/remark
probe POST   /leads/$NIL/workflow/level
probe POST   /leads/$NIL/workflow/conversion

echo "================= META + SHEETS =================="
probe GET    /meta/pages
probe GET    /meta/forms
probe GET    /meta/connectivity
probe GET    /meta/sync-log
probe GET    /sheets/list
probe GET    /sheets/status

echo "================= MISC =================="
probe GET    /distribution/queue
probe GET    /distribution/stats
probe GET    /reports/summary
probe GET    /reports/daily
probe GET    /rankings/my
probe GET    /integrations/status
probe GET    /notifications
probe GET    /settings/distribution
