const http = require('http');

const BASE = 'http://localhost:4000/api';
let token = null;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const fullUrl = path.startsWith('/api') ? 'http://localhost:4000' + path
                  : path.startsWith('/webhooks') ? 'http://localhost:4000' + path
                  : path.startsWith('/health') ? 'http://localhost:4000' + path
                  : BASE + path;
    const url = new URL(fullUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function test(label, method, path, body, expect) {
  try {
    const res = await req(method, path, body);
    const ok = expect ? expect(res) : res.status < 400;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${res.status}] ${label}`);
    if (!ok) console.log('  Response:', JSON.stringify(res.data).slice(0, 200));
    return res;
  } catch (err) {
    console.log(`FAIL [ERR] ${label} - ${err.message}`);
    return null;
  }
}

(async () => {
  console.log('=== API VERIFICATION ===\n');

  // Health
  await test('Health check', 'GET', '/health', null, r => r.status === 200);
  await test('Health DB', 'GET', '/health/db', null, r => r.status === 200);

  // 1. Login
  const loginRes = await test('Login (admin)', 'POST', '/auth/login',
    { identifier: 'prince@digitaladbird.com', password: 'Abhi@9012' },
    r => r.status === 200 && r.data.success);
  if (loginRes) token = loginRes.data.data.accessToken;

  // 2. Auth
  await test('Auth - Get current user', 'GET', '/auth/me', null, r => r.status === 200);

  // 3. Leads
  await test('Leads - List', 'GET', '/leads?page=1&limit=10', null, r => r.status === 200);

  // 4. Users/Team
  await test('Users - List', 'GET', '/users?page=1&limit=10', null, r => r.status === 200);
  await test('Users - RMs', 'GET', '/users?role=rm', null, r => r.status === 200);
  await test('Users - Hierarchy', 'GET', '/users/hierarchy', null, r => r.status === 200);

  // 5. Chat
  await test('Chat - Conversations', 'GET', '/api/chat/conversations', null, r => r.status === 200);
  await test('Chat - Contacts', 'GET', '/api/chat/contacts', null, r => r.status === 200);
  await test('Chat - Unread count', 'GET', '/api/chat/unread', null, r => r.status === 200);
  await test('Chat - Notifications', 'GET', '/api/chat/notifications', null, r => r.status === 200);

  // 6. Meta Webhook verify (at /webhooks/meta, NOT /api/meta/webhook)
  await test('Meta Webhook - Verify (GET)', 'GET',
    '/webhooks/meta?hub.mode=subscribe&hub.verify_token=da6bf80334a51e948e04352272a2631905854dd84e3acae09600363ff9048296&hub.challenge=test123',
    null, r => r.status === 200);

  // 7. Admin stats
  await test('Admin - Live Stats', 'GET', '/admin/live-stats', null, r => r.status === 200);

  // 8. Settings
  await test('Settings - Distribution', 'GET', '/settings/distribution', null, r => r.status === 200);

  // 9. Admin Activity logs
  await test('Admin - Activity Logs', 'GET', '/admin/activity-logs?page=1&page_size=5', null, r => r.status === 200);

  // 10. Lead requests
  await test('Lead requests', 'GET', '/lead-requests', null, r => r.status === 200);

  // 11. Reports
  await test('Reports - Summary', 'GET', '/reports/summary', null, r => r.status === 200);
  await test('Reports - Campaigns', 'GET', '/reports/campaigns', null, r => r.status === 200);
  await test('Reports - Campaign Summary', 'GET', '/reports/campaign-summary', null, r => r.status === 200);
  await test('Reports - By User', 'GET', '/reports/by-user', null, r => r.status === 200);

  // 12. Meta management
  await test('Meta - Pages', 'GET', '/meta/pages', null, r => r.status === 200);
  await test('Meta - Forms', 'GET', '/meta/forms', null, r => r.status === 200);
  await test('Meta - Campaigns', 'GET', '/meta/campaigns', null, r => r.status === 200);
  await test('Integration Status', 'GET', '/integrations/status', null, r => r.status === 200);

  // 13. Distribution
  await test('Distribution - Stats', 'GET', '/distribution/stats', null, r => r.status === 200);
  await test('Distribution - Queue', 'GET', '/distribution/queue', null, r => r.status === 200);

  // 14. Workflow
  await test('Workflow - Stats', 'GET', '/workflow/stats', null, r => r.status === 200);

  // 15. Campaign filter data
  await test('Campaigns - Names', 'GET', '/campaigns/names', null, r => r.status === 200);
  await test('Campaigns - Adsets', 'GET', '/campaigns/adsets', null, r => r.status === 200);

  // 16. Admin tools
  await test('Admin - Notifications', 'GET', '/admin/notifications', null, r => r.status === 200);
  await test('Admin - Active Members', 'GET', '/admin/active-members', null, r => r.status === 200);
  await test('Admin - Unassigned Leads', 'GET', '/admin/unassigned-leads', null, r => r.status === 200);

  // 17. Lead request stats
  await test('Lead Request Stats', 'GET', '/lead-requests/stats', null, r => r.status === 200);

  console.log('\n=== DONE ===');
})();
