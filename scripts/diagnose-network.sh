#!/usr/bin/env bash
# Why does CRM open on mobile data but not on office WiFi?
#
# ERR_CONNECTION_TIMED_OUT means the browser's TCP handshake to port 443
# never completes. That's a connectivity-layer problem, NOT a CRM bug.
# Two sides of the connection — server-side block OR client-side block.
#
# This script runs ON THE VPS and reports:
#   1. Which IPs the server is actually bound to (v4 + v6)
#   2. Which IP DNS resolves crm.digitaladbird.com to (vs reality)
#   3. Whether firewall rules are blocking the office's public IP
#   4. Whether fail2ban has banned any IPs recently
#   5. Whether Nginx has IP allow/deny lists
#   6. Whether Hostinger / Cloudflare is in front
#
# After running this, ALSO run the office-side checklist at the bottom
# of this file FROM the office WiFi.
#
# Usage on VPS:
#   ssh root@<vps>
#   cd /var/www/crm
#   bash scripts/diagnose-network.sh

set -uo pipefail
hdr()  { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
DOMAIN="crm.digitaladbird.com"

# ============================================================
hdr "1. Which IPs does the public DNS resolve $DOMAIN to?"
# ============================================================
echo "A    (IPv4):"
dig +short A    "$DOMAIN" @1.1.1.1 2>&1 | sed 's/^/  /'
echo "AAAA (IPv6):"
dig +short AAAA "$DOMAIN" @1.1.1.1 2>&1 | sed 's/^/  /'
echo
echo "(If AAAA returns an IPv6 address but the server has no working v6,"
echo " browsers on IPv6-preferred networks try v6 first and time out.)"

# ============================================================
hdr "2. Which IPs is this server ACTUALLY using?"
# ============================================================
echo "Public IPv4 (from icanhazip):"
curl -s -4 https://icanhazip.com 2>&1 | sed 's/^/  /'
echo "Public IPv6 (from icanhazip):"
curl -s -6 https://icanhazip.com 2>&1 | sed 's/^/  /' || echo "  (no IPv6 path)"

echo
echo "All bound interfaces:"
ip -brief addr 2>/dev/null | sed 's/^/  /'

# ============================================================
hdr "3. Is the firewall blocking 80/443 from anywhere?"
# ============================================================
echo "ufw status:"
ufw status verbose 2>/dev/null | sed 's/^/  /' || echo "  (ufw not installed)"
echo
echo "iptables INPUT chain (filter):"
iptables -L INPUT -n --line-numbers 2>&1 | head -30 | sed 's/^/  /'
echo
echo "ip6tables INPUT chain:"
ip6tables -L INPUT -n 2>&1 | head -15 | sed 's/^/  /'

# ============================================================
hdr "4. fail2ban — any IPs currently banned?"
# ============================================================
if command -v fail2ban-client >/dev/null 2>&1; then
  fail2ban-client status 2>/dev/null | sed 's/^/  /'
  for jail in $(fail2ban-client status 2>/dev/null | grep "Jail list" | sed 's/^.*://;s/,//g'); do
    echo
    echo "  Jail: $jail"
    fail2ban-client status "$jail" 2>/dev/null | grep -E "Banned|Currently" | sed 's/^/    /'
  done
else
  echo "  fail2ban not installed (or not on PATH)"
fi

# ============================================================
hdr "5. Nginx — any IP allow/deny that could block the office?"
# ============================================================
if command -v nginx >/dev/null 2>&1; then
  echo "config dump filtered for allow/deny/geo/limit_req:"
  nginx -T 2>/dev/null | grep -E "^\s*(allow|deny|geo|limit_req_zone|limit_conn_zone|server_name)" | head -40 | sed 's/^/  /'
  echo
  echo "Listening sockets owned by nginx:"
  ss -tlnp 2>/dev/null | grep -E ':(80|443) ' | sed 's/^/  /'
else
  echo "  nginx not installed"
fi

# ============================================================
hdr "6. SSL certificate — what hostnames is it valid for?"
# ============================================================
echo "Certificate served on $DOMAIN:443:"
echo | timeout 5 openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null \
  | sed 's/^/  /'
echo
echo "Same probe via external DNS path:"
echo | timeout 5 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null \
  | sed 's/^/  /'

# ============================================================
hdr "7. Cloudflare / proxy / CDN in front of the origin?"
# ============================================================
echo "Response headers for https://$DOMAIN/health (HEAD):"
curl -s -I --max-time 8 "https://$DOMAIN/health" 2>&1 \
  | grep -iE "server|via|cf-ray|x-cache|x-served-by|x-vercel|fly-request-id|hostinger" \
  | sed 's/^/  /'
echo
echo "If you see  cf-ray  or  server: cloudflare,  CF is in front. WAF/Bot"
echo "Fight Mode can block office IP ranges. Check CF dashboard → Security → Events."

# ============================================================
hdr "8. Are 80/443 reachable from THIS server's POV?"
# ============================================================
for p in 80 443; do
  printf "  %s/tcp on 127.0.0.1   : " "$p"
  timeout 2 bash -c "</dev/tcp/127.0.0.1/$p" 2>/dev/null && echo "open" || echo "CLOSED"
done

# ============================================================
hdr "9. Anti-DDoS / rate-limit logs (last 30 min)"
# ============================================================
echo "Nginx access log — recent 4xx/5xx from same IP block (top 10):"
tail -20000 /var/log/nginx/access.log 2>/dev/null \
  | awk '$9 ~ /^(4|5)[0-9][0-9]$/ {print $1, $9}' \
  | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /' || echo "  (no access log)"
echo
echo "Nginx error log — last 10:"
tail -10 /var/log/nginx/error.log 2>/dev/null | sed 's/^/  /'

# ============================================================
hdr "OFFICE-SIDE CHECKLIST  (run THESE from the office WiFi)"
# ============================================================
cat <<EOF

From a laptop on the office WiFi, open a terminal and run:

  # 1. DNS — does the office resolver give the SAME IP as section 1 above?
  nslookup crm.digitaladbird.com
  nslookup crm.digitaladbird.com 1.1.1.1

  If office DNS returns a different IP, the office WiFi has DNS hijack /
  captive portal / split-horizon. Fix: set device DNS to 1.1.1.1 / 8.8.8.8.

  # 2. TCP — can the office reach port 443 at all?
  # macOS/Linux:
  nc -vz crm.digitaladbird.com 443
  # Windows PowerShell:
  Test-NetConnection crm.digitaladbird.com -Port 443

  If "Connection timed out" → office firewall blocks outbound to that IP.
  If "Connection refused" → reached the server but it refused (very different).

  # 3. Force IPv4-only (in case AAAA is poisoning the path):
  curl -4 -v --max-time 10 https://crm.digitaladbird.com/health
  curl -6 -v --max-time 10 https://crm.digitaladbird.com/health

  If -4 works but -6 hangs → the office has broken IPv6. Tell DNS to stop
  serving AAAA (remove the AAAA record at Hostinger DNS) until IPv6 is fixed.

  # 4. What's the office's public IP? (so we can check if it's banned)
  curl -s https://icanhazip.com

  Paste that IP back. Then on the VPS:
    fail2ban-client status sshd | grep -i <office-public-ip>
    grep -i <office-public-ip> /var/log/nginx/access.log | tail
    grep -i <office-public-ip> /var/log/auth.log | tail

  If the office IP appears in fail2ban banned list → unban:
    fail2ban-client set sshd unbanip <office-public-ip>

  # 5. Traceroute — where does the path die?
  traceroute crm.digitaladbird.com         # Linux/Mac
  tracert    crm.digitaladbird.com         # Windows

  Last hop that responds is where the block sits. If it dies inside the
  office's first 2-3 hops → office firewall. If it dies near Hostinger's
  edge → upstream / CF block. If every hop times out from hop 1 → office
  router has the destination IP in a blacklist.

EOF

# ============================================================
hdr "VERDICT — match the symptom to the cause"
# ============================================================
cat <<'EOF'

Most common causes of "works on mobile data, dies on office WiFi", ranked:

  A. Office firewall blocks the VPS IP range (Hostinger / OVH / DigitalOcean
     IP blocks are frequently on corporate-firewall blacklists because they
     host bulk hosting).
     → Fix: ask office IT to whitelist the IP shown in Section 2 above.
     → Or move CRM behind Cloudflare so the office hits CF edge (which is
       almost never blocked).

  B. Office DNS hijack — captive portal / Pi-hole / corporate DNS resolves
     the domain to 0.0.0.0 or an internal IP.
     → Symptom: nslookup from office returns wrong IP vs Section 1.
     → Fix: device-level DNS = 1.1.1.1, or ask IT to whitelist the domain
       in the office DNS resolver.

  C. Broken IPv6 path — AAAA record exists, office has IPv6 enabled but no
     working v6 route.
     → Symptom: curl -6 hangs, curl -4 works.
     → Fix: remove the AAAA record at Hostinger DNS (keep only A), OR fix
       the server's IPv6 binding.

  D. fail2ban banned the office IP after auth/login retries.
     → Symptom: section 4 shows office IP in banned list.
     → Fix: unban, then raise fail2ban findtime/maxretry so legit users
       behind one NAT don't trip it.

  E. Cloudflare / Hostinger WAF blocked the office IP for "bot score".
     → Symptom: section 7 shows  cf-ray  header; CF dashboard → Security
       Events shows blocks from the office IP.
     → Fix: add CF firewall rule  ip.src eq <office-ip>  → Allow.

  F. Hostinger network panel — the VPS got a new IP after migration and
     DNS still points to the old IP.
     → Symptom: section 1 IP != section 2 IP.
     → Fix: update the A record at Hostinger DNS to match section 2.

Paste the full output back to Claude. The combination of sections
1/2/3/4/7 will pin down which of A-F is hitting you.
EOF
