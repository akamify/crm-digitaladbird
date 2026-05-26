/**
 * DEMO SEED — 20 realistic leads + assignments, remarks, partner requests, notifications.
 *
 * All demo leads use   category = 'demo_seed'   so they can be removed with:
 *   node cleanup_demo_leads.js
 *
 * Run:  node seed_demo_leads.js
 */

const { query } = require('./src/config/database');

const DEMO_TAG = 'demo_seed'; // stored in product_tag for leads, category for partner_requests

const LEADS = [
  { full_name: 'Aarav Mehta',       phone: '+919000100001', email: 'aarav.mehta@demo.test',       city: 'Mumbai',      state: 'Maharashtra',    source: 'meta',    campaign_name: 'FB - Home Loan Q2',      stage: 'new',          call_status: 'not_called' },
  { full_name: 'Priya Sharma',      phone: '+919000100002', email: 'priya.sharma@demo.test',      city: 'Delhi',       state: 'Delhi',          source: 'meta',    campaign_name: 'FB - Credit Card Jun',   stage: 'contacted',    call_status: 'interested' },
  { full_name: 'Rohan Gupta',       phone: '+919000100003', email: 'rohan.gupta@demo.test',       city: 'Bangalore',   state: 'Karnataka',      source: 'google',  campaign_name: 'Google - Personal Loan', stage: 'qualified',    call_status: 'callback_requested' },
  { full_name: 'Sneha Patel',       phone: '+919000100004', email: 'sneha.patel@demo.test',       city: 'Ahmedabad',   state: 'Gujarat',        source: 'meta',    campaign_name: 'FB - Insurance May',     stage: 'proposal',     call_status: 'interested' },
  { full_name: 'Vikram Singh',      phone: '+919000100005', email: 'vikram.singh@demo.test',      city: 'Jaipur',      state: 'Rajasthan',      source: 'manual',  campaign_name: 'Walk-in Referral',       stage: 'won',          call_status: 'converted' },
  { full_name: 'Ananya Reddy',      phone: '+919000100006', email: 'ananya.reddy@demo.test',      city: 'Hyderabad',   state: 'Telangana',      source: 'meta',    campaign_name: 'FB - Home Loan Q2',      stage: 'contacted',    call_status: 'rnr' },
  { full_name: 'Karan Verma',       phone: '+919000100007', email: 'karan.verma@demo.test',       city: 'Lucknow',     state: 'Uttar Pradesh',  source: 'google',  campaign_name: 'Google - Car Loan',      stage: 'new',          call_status: 'not_called' },
  { full_name: 'Divya Nair',        phone: '+919000100008', email: 'divya.nair@demo.test',        city: 'Kochi',       state: 'Kerala',         source: 'meta',    campaign_name: 'FB - Gold Loan Jun',     stage: 'qualified',    call_status: 'follow_up' },
  { full_name: 'Arjun Deshmukh',    phone: '+919000100009', email: 'arjun.deshmukh@demo.test',    city: 'Pune',        state: 'Maharashtra',    source: 'meta',    campaign_name: 'FB - Credit Card Jun',   stage: 'lost',         call_status: 'not_interested' },
  { full_name: 'Meera Iyer',        phone: '+919000100010', email: 'meera.iyer@demo.test',        city: 'Chennai',     state: 'Tamil Nadu',     source: 'manual',  campaign_name: 'Partner Referral',       stage: 'proposal',     call_status: 'interested' },
  { full_name: 'Rahul Tiwari',      phone: '+919000100011', email: 'rahul.tiwari@demo.test',      city: 'Bhopal',      state: 'Madhya Pradesh', source: 'meta',    campaign_name: 'FB - Home Loan Q2',      stage: 'new',          call_status: 'not_called' },
  { full_name: 'Pooja Saxena',      phone: '+919000100012', email: 'pooja.saxena@demo.test',      city: 'Noida',       state: 'Uttar Pradesh',  source: 'google',  campaign_name: 'Google - Personal Loan', stage: 'contacted',    call_status: 'callback_requested' },
  { full_name: 'Aditya Joshi',      phone: '+919000100013', email: 'aditya.joshi@demo.test',      city: 'Nagpur',      state: 'Maharashtra',    source: 'meta',    campaign_name: 'FB - Insurance May',     stage: 'qualified',    call_status: 'interested' },
  { full_name: 'Nisha Agarwal',     phone: '+919000100014', email: 'nisha.agarwal@demo.test',     city: 'Kolkata',     state: 'West Bengal',    source: 'meta',    campaign_name: 'FB - Gold Loan Jun',     stage: 'new',          call_status: 'rnr' },
  { full_name: 'Siddharth Malhotra', phone: '+919000100015', email: 'sid.malhotra@demo.test',     city: 'Chandigarh',  state: 'Punjab',         source: 'manual',  campaign_name: 'Walk-in Referral',       stage: 'contacted',    call_status: 'follow_up' },
  { full_name: 'Kavita Bhatt',      phone: '+919000100016', email: 'kavita.bhatt@demo.test',      city: 'Dehradun',    state: 'Uttarakhand',    source: 'meta',    campaign_name: 'FB - Home Loan Q2',      stage: 'won',          call_status: 'converted' },
  { full_name: 'Manish Rao',        phone: '+919000100017', email: 'manish.rao@demo.test',        city: 'Vizag',       state: 'Andhra Pradesh', source: 'google',  campaign_name: 'Google - Car Loan',      stage: 'proposal',     call_status: 'interested' },
  { full_name: 'Ritu Kapoor',       phone: '+919000100018', email: 'ritu.kapoor@demo.test',       city: 'Gurgaon',     state: 'Haryana',        source: 'meta',    campaign_name: 'FB - Credit Card Jun',   stage: 'new',          call_status: 'not_called' },
  { full_name: 'Deepak Chauhan',    phone: '+919000100019', email: 'deepak.chauhan@demo.test',    city: 'Indore',      state: 'Madhya Pradesh', source: 'meta',    campaign_name: 'FB - Insurance May',     stage: 'qualified',    call_status: 'callback_requested' },
  { full_name: 'Shruti Mishra',     phone: '+919000100020', email: 'shruti.mishra@demo.test',     city: 'Patna',       state: 'Bihar',          source: 'manual',  campaign_name: 'Partner Referral',       stage: 'contacted',    call_status: 'follow_up' },
];

const REMARKS = [
  'Spoke with customer, interested in ₹25L home loan. Sending docs.',
  'Not reachable — tried twice. Will retry tomorrow morning.',
  'Customer wants callback after 5 PM today.',
  'Discussed premium credit card benefits. Sending application link.',
  'Visited branch, KYC completed. File submitted to processing.',
  'Customer asked for lower interest rate comparison. Preparing sheet.',
  'Wrong number — verified from form. Marking as junk.',
  'Customer already has a loan from SBI. Not interested right now.',
  'Very interested. Wants ₹10L personal loan urgently for wedding.',
  'Sent WhatsApp follow-up. Waiting for documents.',
  'Customer confirmed — will visit branch on Saturday.',
  'Requested EMI calculator details. Sent via email.',
  'Customer wants to discuss with spouse. Follow up in 2 days.',
  'Pre-approved for ₹15L. Sent sanction letter for review.',
  'Customer switched off phone. Will try again tomorrow.',
  'Completed video KYC. File moving to disbursal.',
  'Customer comparing with HDFC offer. Needs rate match.',
  'Good lead — business owner, needs working capital loan ₹50L.',
  'Follow-up done. Customer says will decide by end of week.',
  'Converted! Loan disbursed ₹20L. Customer very happy.',
];

(async () => {
  console.log('=== DEMO SEED START ===\n');

  const { rows: admins }  = await query("SELECT id, full_name FROM users WHERE role='super_admin' AND status='active' LIMIT 2");
  const { rows: rms }     = await query("SELECT id, full_name FROM users WHERE role='rm' AND status='active' LIMIT 4");
  const { rows: members } = await query("SELECT id, full_name, report_to_id FROM users WHERE role='member' AND status='active' LIMIT 10");
  const { rows: partners }= await query("SELECT id, full_name FROM users WHERE role='partner' AND status='active' LIMIT 3");

  const allAssignees = [...members, ...partners.slice(0, 1)];
  const leadIds = [];

  // ─── 1. Insert 20 leads ───
  for (let i = 0; i < LEADS.length; i++) {
    const l = LEADS[i];
    const assignee = i < 15 ? allAssignees[i % allAssignees.length] : null; // 5 unassigned
    const daysAgo = Math.floor(Math.random() * 14) + 1;
    const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

    const nextFollowup = ['callback_requested', 'follow_up', 'interested'].includes(l.call_status)
      ? new Date(Date.now() + (Math.floor(Math.random() * 5) + 1) * 86400000).toISOString()
      : null;

    const { rows: [row] } = await query(`
      INSERT INTO leads (
        full_name, phone, email, city, state, source, campaign_name,
        stage, call_status, category, product_tag,
        assigned_to_user_id, assigned_at,
        next_followup_at, call_attempts, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
      RETURNING id
    `, [
      l.full_name, l.phone, l.email, l.city, l.state, l.source, l.campaign_name,
      l.stage, l.call_status, 'partner', DEMO_TAG,
      assignee?.id || null,
      assignee ? createdAt : null,
      nextFollowup,
      ['not_called', 'rnr'].includes(l.call_status) ? 0 : Math.floor(Math.random() * 4) + 1,
      createdAt,
    ]);
    leadIds.push(row.id);

    // Insert assignment record
    if (assignee) {
      const assignedBy = assignee.report_to_id || rms[i % rms.length]?.id || admins[0]?.id;
      await query(`
        INSERT INTO lead_assignments (lead_id, user_id, assigned_by, reason, assigned_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [row.id, assignee.id, assignedBy, 'demo_seed', createdAt]);
    }
  }
  console.log(`[1] Inserted ${leadIds.length} leads (category='${DEMO_TAG}')`);

  // ─── 2. Add remarks / call activity ───
  let remarkCount = 0;
  for (let i = 0; i < leadIds.length; i++) {
    if (LEADS[i].call_status === 'not_called') continue; // no remarks on untouched leads
    const assignee = i < 15 ? allAssignees[i % allAssignees.length] : members[0];
    const numRemarks = Math.min(Math.floor(Math.random() * 3) + 1, 3);

    for (let r = 0; r < numRemarks; r++) {
      const daysAgo = Math.floor(Math.random() * 10) + 1;
      const nextFollowup = r === numRemarks - 1 && ['callback_requested', 'follow_up', 'interested'].includes(LEADS[i].call_status)
        ? new Date(Date.now() + (Math.floor(Math.random() * 5) + 1) * 86400000).toISOString()
        : null;

      await query(`
        INSERT INTO lead_remarks (lead_id, user_id, call_status, remark, next_followup_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        leadIds[i],
        assignee.id,
        LEADS[i].call_status,
        REMARKS[(i * 3 + r) % REMARKS.length],
        nextFollowup,
        new Date(Date.now() - daysAgo * 86400000).toISOString(),
      ]);
      remarkCount++;
    }
  }
  console.log(`[2] Inserted ${remarkCount} remarks / call logs`);

  // ─── 3. Partner lead requests (2 requests) ───
  const partnerA = partners[0];
  const partnerB = partners[1] || partners[0];

  const { rows: [pr1] } = await query(`
    INSERT INTO partner_lead_requests (partner_id, quantity, note, status, assigned_rm_id, resolved_by, resolved_at, leads_assigned, category, created_at, updated_at)
    VALUES ($1, 30, 'Need 30 home loan leads for Mumbai region — Q2 push', 'assigned', $2, $2, NOW(), 5, $3, NOW() - INTERVAL '3 days', NOW())
    RETURNING id
  `, [partnerA.id, rms[0]?.id, DEMO_TAG]);

  const { rows: [pr2] } = await query(`
    INSERT INTO partner_lead_requests (partner_id, quantity, note, status, category, created_at, updated_at)
    VALUES ($1, 15, 'Credit card leads for Delhi NCR campaign', 'pending', $2, NOW() - INTERVAL '1 day', NOW())
    RETURNING id
  `, [partnerB.id, DEMO_TAG]);

  // Timeline entries
  await query(`INSERT INTO partner_request_timeline (request_id, actor_id, action, detail, created_at) VALUES ($1,$2,'created','Requested 30 home loan leads for Mumbai',NOW()-INTERVAL '3 days')`, [pr1.id, partnerA.id]);
  await query(`INSERT INTO partner_request_timeline (request_id, actor_id, action, detail, created_at) VALUES ($1,$2,'approved','Approved by RM — Mumbai leads batch ready',NOW()-INTERVAL '2 days')`, [pr1.id, rms[0]?.id]);
  await query(`INSERT INTO partner_request_timeline (request_id, actor_id, action, detail, created_at) VALUES ($1,$2,'assigned','5 leads auto-assigned (5/30 total)',NOW()-INTERVAL '1 day')`, [pr1.id, rms[0]?.id]);
  await query(`INSERT INTO partner_request_timeline (request_id, actor_id, action, detail, created_at) VALUES ($1,$2,'created','Requested 15 credit card leads for Delhi NCR',NOW()-INTERVAL '1 day')`, [pr2.id, partnerB.id]);
  console.log(`[3] Inserted 2 partner requests + 4 timeline entries`);

  // ─── 4. Notifications for all roles ───
  const notifRecipients = [
    ...admins.map(a => ({ id: a.id, role: 'admin' })),
    ...rms.slice(0, 2).map(r => ({ id: r.id, role: 'rm' })),
    ...members.slice(0, 3).map(m => ({ id: m.id, role: 'member' })),
    ...partners.slice(0, 2).map(p => ({ id: p.id, role: 'partner' })),
  ];

  const notifications = [
    { type: 'partner_request',  title: `${partnerA.full_name} requested 30 leads`,     body: 'Home loan leads for Mumbai region — Q2 push', hoursAgo: 72 },
    { type: 'request_approved', title: 'Your request for 30 leads has been approved',   body: 'RM approved. Leads will be assigned shortly.', hoursAgo: 48 },
    { type: 'leads_delivered',  title: '5 leads assigned to you',                       body: 'Home loan leads batch 1 — check your dashboard.', hoursAgo: 24 },
    { type: 'partner_request',  title: `${partnerB.full_name} requested 15 leads`,     body: 'Credit card leads for Delhi NCR campaign', hoursAgo: 20 },
    { type: 'rm_assigned',      title: 'New lead assigned: Aarav Mehta',                body: 'FB - Home Loan Q2 campaign lead from Mumbai', hoursAgo: 10 },
    { type: 'rm_assigned',      title: 'New lead assigned: Priya Sharma',               body: 'FB - Credit Card Jun campaign lead from Delhi', hoursAgo: 8 },
    { type: 'leads_delivered',  title: '3 new leads in your queue',                     body: 'Check your leads tab for newly assigned leads.', hoursAgo: 5 },
    { type: 'partner_request',  title: 'Pending request needs your approval',           body: '15 credit card leads requested — awaiting RM review', hoursAgo: 3 },
  ];

  let notifCount = 0;
  for (const n of notifications) {
    const targets = n.type === 'request_approved' || n.type === 'leads_delivered'
      ? notifRecipients.filter(r => r.role === 'partner')
      : n.type === 'rm_assigned'
        ? notifRecipients.filter(r => r.role === 'member')
        : notifRecipients.filter(r => ['admin', 'rm'].includes(r.role));

    for (const t of targets) {
      await query(`
        INSERT INTO user_notifications (user_id, type, title, body, metadata, is_read, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${n.hoursAgo} hours')
      `, [
        t.id, n.type, n.title, n.body,
        JSON.stringify({ demo: true, request_id: pr1.id }),
        Math.random() > 0.6,
      ]);
      notifCount++;
    }
  }
  console.log(`[4] Inserted ${notifCount} notifications across ${notifRecipients.length} users`);

  // ─── Summary ───
  console.log(`\n=== DEMO SEED COMPLETE ===`);
  console.log(`   20 leads (category = '${DEMO_TAG}')`);
  console.log(`   ${remarkCount} call remarks`);
  console.log(`   2 partner requests (category = '${DEMO_TAG}')`);
  console.log(`   ${notifCount} notifications (metadata.demo = true)`);
  console.log(`\n   To remove all demo data:  node cleanup_demo_leads.js\n`);

  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
