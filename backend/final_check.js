const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function request(method, path, token, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: 'localhost', port: 4000, path, method, headers }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, d: JSON.parse(out) }); }
        catch { resolve({ s: res.statusCode, d: { raw: out.substring(0, 100) } }); }
      });
    });
    r.on('error', e => resolve({ s: 0, d: { error: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}

function frontend(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3000${path}`, { timeout: 5000 }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve({ s: res.statusCode, len: out.length }));
    }).on('error', e => resolve({ s: 0, err: e.message }));
  });
}

let pass = 0, fail = 0, total = 0;
function ok(label, cond, info) {
  total++;
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}${info ? ` — ${info}` : ''}`); }
  else      { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${info ? ` — ${info}` : ''}`); }
}

(async () => {
  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL PRE-DEPLOYMENT CHECK — DigitalADbird CRM            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\x1b[0m\n');

  // ═══ FRONTEND PAGES ═══
  console.log('\x1b[1m── FRONTEND PAGES ──\x1b[0m');
  for (const [label, path] of [
    ['Login page', '/login'],
    ['Admin dashboard', '/dashboard/admin'],
    ['RM dashboard', '/dashboard/rm'],
    ['Member dashboard', '/dashboard/member'],
    ['Leads page', '/leads'],
  ]) {
    const r = await frontend(path);
    ok(label, r.s === 200, `${r.len} bytes`);
  }

  // ═══ AUTH — ALL LOGIN METHODS ═══
  console.log('\n\x1b[1m── AUTHENTICATION ──\x1b[0m');
  const logins = [
    ['Admin email',   { identifier: 'anshusingh00108@gmail.com', password: 'Abhi@7086', role: 'admin' }],
    ['Admin CP ID',   { identifier: 'ABH7086SING', password: 'Abhi@7086', role: 'admin' }],
    ['Admin phone',   { identifier: '9149050944', password: 'Abhi@7086', role: 'admin' }],
    ['Admin2 email',  { identifier: 'digitaladbirddmk@gmail.com', password: 'Rohit@123', role: 'admin' }],
    ['RM CP ID',      { identifier: 'SBA28071544', password: 'Abhi@708090', role: 'rm' }],
    ['RM email',      { identifier: 'manishadigitaladbird@gmail.com', password: 'Abhi@708090', role: 'rm' }],
    ['RM phone',      { identifier: '9548431936', password: 'Abhi@708090', role: 'rm' }],
    ['Partner CP ID', { identifier: '1553', password: 'Abhi@708090', role: 'partner' }],
    ['Partner email', { identifier: 'vlata015@gmail.com', password: 'Abhi@708090', role: 'partner' }],
    ['Partner phone', { identifier: '9858455865', password: 'Abhi@708090', role: 'partner' }],
  ];

  let adminToken;
  for (const [label, body] of logins) {
    await sleep(400);
    const r = await request('POST', '/api/auth/login', null, body);
    ok(label, r.s === 200, r.d.data?.user?.name || r.d.error?.message);
    if (!adminToken && r.s === 200) adminToken = r.d.data.accessToken;
  }

  // ═══ ROLE ENFORCEMENT ═══
  console.log('\n\x1b[1m── ROLE ENFORCEMENT ──\x1b[0m');
  await sleep(400);
  let r = await request('POST', '/api/auth/login', null, { identifier: 'anshusingh00108@gmail.com', password: 'Abhi@7086', role: 'rm' });
  ok('Deny admin as RM', r.s === 403, r.d.error?.code);
  await sleep(400);
  r = await request('POST', '/api/auth/login', null, { identifier: 'SBA28071544', password: 'Abhi@708090', role: 'admin' });
  ok('Deny RM as admin', r.s === 403, r.d.error?.code);
  await sleep(400);
  r = await request('POST', '/api/auth/login', null, { identifier: '1553', password: 'wrong', role: 'partner' });
  ok('Deny wrong password', r.s === 401, r.d.error?.code);

  // ═══ JWT ═══
  console.log('\n\x1b[1m── JWT & SESSION ──\x1b[0m');
  await sleep(400);
  r = await request('GET', '/api/auth/me', adminToken);
  ok('GET /auth/me', r.s === 200, `${r.d.data?.name} (${r.d.data?.role})`);

  // ═══ API ENDPOINTS ═══
  console.log('\n\x1b[1m── API ENDPOINTS (as admin) ──\x1b[0m');
  const endpoints = [
    ['Summary report', '/api/reports/summary'],
    ['Users list', '/api/users?page=1&page_size=5'],
    ['Leads list', '/api/leads?page=1&page_size=5'],
    ['Daily report', '/api/reports/daily?days=7'],
    ['Funnel report', '/api/reports/funnel'],
    ['Sources report', '/api/reports/sources'],
    ['User performance', '/api/reports/by-user'],
    ['Campaign names', '/api/campaigns/names'],
    ['Campaign report', '/api/reports/campaigns'],
    ['Distribution rules', '/api/rules'],
    ['Distribution settings', '/api/settings/distribution'],
    ['Distribution queue', '/api/distribution/queue'],
    ['Distribution stats', '/api/distribution/stats'],
    ['Lead request stats', '/api/lead-requests/stats'],
    ['Integration status', '/api/integrations/status'],
    ['Admin live stats', '/api/admin/live-stats'],
    ['Activity logs', '/api/admin/activity-logs'],
    ['Notifications', '/api/admin/notifications'],
    ['Broadcast messages', '/api/admin/broadcast'],
    ['Active members', '/api/admin/active-members'],
    ['Team leads', '/api/reports/team-leads'],
    ['Meta campaigns', '/api/meta/campaigns'],
    ['Blocked members', '/api/distribution/blocked'],
    ['Pending approvals', '/api/distribution/approvals'],
    ['RM lead requests', '/api/rm-lead-requests'],
  ];
  for (const [label, path] of endpoints) {
    await sleep(200);
    const r = await request('GET', path, adminToken);
    ok(label, r.s === 200, r.s !== 200 ? r.d.error?.message : undefined);
  }

  // ═══ SUMMARY ═══
  console.log('\n\x1b[1m══════════════════════════════════════════════════════════════\x1b[0m');
  const color = fail === 0 ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}RESULTS: ${pass}/${total} passed, ${fail} failed\x1b[0m`);
  console.log('\x1b[1m══════════════════════════════════════════════════════════════\x1b[0m');

  if (fail === 0) {
    console.log(`
  \x1b[32m★ CRM IS FULLY WORKING — READY FOR VPS DEPLOYMENT ★\x1b[0m

  \x1b[1mFrontend:\x1b[0m  http://localhost:3000
  \x1b[1mBackend:\x1b[0m   http://localhost:4000/api
  \x1b[1mDatabase:\x1b[0m  postgres://localhost:5433/digitaladbird
  \x1b[1mProject:\x1b[0m   c:\\Users\\vinit\\Downloads\\files\\digitaladbird-crm\\digitaladbird-crm
`);
  } else {
    console.log(`\n  \x1b[33m⚠ ${fail} issue(s) need attention.\x1b[0m\n`);
  }
})();
