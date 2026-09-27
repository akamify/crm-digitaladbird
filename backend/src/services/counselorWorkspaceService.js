const { AppError } = require('../utils/errors');

const TABS = Object.freeze(['received','new','old','worked','pending','cc','responded','call_issues',
  'common_meeting','dim','personal_meeting','follow_up','quotation','hot','warm','special_category',
  'call_reminder','handover_rm','not_attended','converted','cold','process_incomplete']);

function period(input) {
  if (input.lead_view === 'all_time' || (!input.lead_view && !input.from && !input.to)) return {view:'all_time',from:null,to:null};
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const from = input.from || today;
  const to = input.to || from;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new AppError(400,'INVALID_DATE_RANGE','Choose a valid date range.');
  return {view:'daily',from,to};
}

async function workspace(db,user,input,membership) {
  const dates = period(input);
  const view = input.view || 'all';
  if (!TABS.includes(view) && view !== 'all') membership(view); // Reuse the status allowlist.
  if (input.assigned_to && input.assigned_to !== user.id) throw new AppError(403,'WORKFLOW_FORBIDDEN','Only your counselor scope is available.');
  const params = [user.id,dates.from,dates.to];
  const add = value => { params.push(value); return `$${params.length}`; };
  const within = column => dates.view === 'all_time' ? 'TRUE'
    : `${column} >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${column} < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const filters = ['l.deleted_at IS NULL'];
  const text = value => typeof value === 'string' ? value.trim() : '';
  if (text(input.q)) {
    const p = add(`%${text(input.q).replace(/[\\%_]/g,'\\$&')}%`);
    filters.push(`(l.full_name ILIKE ${p} OR l.phone ILIKE ${p} OR l.email ILIKE ${p})`);
  }
  for (const field of ['source','category','stage']) if (text(input[field])) filters.push(`l.${field}::text=${add(text(input[field]))}`);
  if (text(input.primary_status)) filters.push(`s.journey_active AND s.primary_status=${add(text(input.primary_status))}`);
  if (text(input.call_status)) filters.push(`s.journey_active AND s.primary_status=${add(text(input.call_status))}`);
  if (text(input.remark_status)) filters.push(`EXISTS (SELECT 1 FROM counselor_workflow_events re WHERE re.lead_id=l.id AND re.statuses ? ${add(text(input.remark_status))})`);
  if (text(input.campaign)) {
    const p = add(`%${text(input.campaign)}%`);
    filters.push(`(l.campaign_name ILIKE ${p} OR l.campaign_label ILIKE ${p})`);
  }
  const followup = {
    today: "(l.next_followup_at AT TIME ZONE 'Asia/Kolkata')::date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date",
    overdue:'l.next_followup_at < NOW()', upcoming:'l.next_followup_at > NOW()',
    week:"l.next_followup_at BETWEEN NOW() AND NOW()+INTERVAL '7 days'", no_followup:'l.next_followup_at IS NULL',
  };
  if (input.followup) {
    if (!Object.hasOwn(followup,input.followup)) throw new AppError(400,'INVALID_FILTER','Unsupported follow-up filter.');
    filters.push(followup[input.followup]);
  }
  // Do not silently accept legacy predicates whose semantics differ here.
  for (const key of ['workflow_status','latest_activity','customer_interest','label_id','form_id','campaign_id','adset','assignment']) {
    if (text(input[key])) throw new AppError(400,'UNSUPPORTED_WORKFLOW_FILTER',`Remove the legacy ${key} filter to use this workspace.`);
  }
  const active = `l.assigned_to_user_id=$1 AND r.lead_id IS NOT NULL`;
  const predicate = key => key === 'received' ? 'r.lead_id IS NOT NULL'
    : key === 'worked' ? 'w.lead_id IS NOT NULL'
      : key === 'all' ? 'l.assigned_to_user_id=$1' : `(${active} AND (${membership(key)}))`;
  const flagKeys = [...new Set([...TABS,'all',view])];
  const page = Math.max(1,Math.min(100000,Number.parseInt(input.page,10)||1));
  const offset = add((page-1)*25);
  const {rows:[result]} = await db.query(`WITH bounds AS (SELECT $2::date AS from_date,$3::date AS to_date), work AS MATERIALIZED (
    SELECT lead_id,BOOL_OR(work_source='new') AS n,BOOL_OR(work_source='old') AS o,MAX(occurred_at) AS worked_at
    FROM counselor_workflow_events WHERE actor_id=$1 AND is_work AND work_source IN ('new','old') AND (${within('occurred_at')})
    GROUP BY lead_id
  ), received AS MATERIALIZED (
    SELECT lead_id FROM lead_assignments WHERE COALESCE(assigned_to_user_id,user_id)=$1 AND (${within('assigned_at')})
    UNION SELECT id FROM leads WHERE assigned_to_user_id=$1 AND (${within('assigned_at')})
  ), classified AS MATERIALIZED (
    SELECT l.id AS lead_id,l.id,l.full_name,l.phone,l.email,l.source,l.category,l.campaign_name,l.campaign_label,
      l.next_followup_at,l.assigned_at,l.assigned_to_user_id,
      l.assigned_to_user_id IS DISTINCT FROM $1::uuid AS read_only,
      s.primary_status,s.journey_active,s.queue,s.generation,s.policy_version,s.move_to_old_at,s.move_to_pending_at,
      s.followup_override,s.assignment_at,s.assignment_id,s.awaiting_primary,
      COALESCE(w.n,FALSE) AS worked_n,COALESCE(w.o,FALSE) AS worked_o,w.worked_at,
      jsonb_build_object(${flagKeys.map(key => `'${key}',(${predicate(key)}) IS TRUE`).join(',')}) AS memberships
    FROM leads l
    LEFT JOIN counselor_workflow_state s ON s.lead_id=l.id AND s.assigned_to_user_id=l.assigned_to_user_id
      AND s.assignment_at IS NOT DISTINCT FROM l.assigned_at AND l.assigned_to_user_id=$1
    LEFT JOIN received r ON r.lead_id=l.id LEFT JOIN work w ON w.lead_id=l.id
    WHERE (l.assigned_to_user_id=$1 OR EXISTS (SELECT 1 FROM lead_assignments access WHERE access.lead_id=l.id AND access.previous_user_id=$1))
      AND ${filters.join(' AND ')}
  ), selected AS (SELECT * FROM classified WHERE (memberships->>'${view}')::boolean)
  SELECT (SELECT COUNT(*)::int FROM selected) AS total,
    (SELECT jsonb_build_object(${TABS.map(key => `'${key}',${key === 'worked' ? 'COALESCE(SUM(worked_n::int+worked_o::int),0)::int' : `COUNT(*) FILTER (WHERE (memberships->>'${key}')::boolean)::int`}`).join(',')}) FROM classified) AS summary,
    (SELECT jsonb_build_object('n',COALESCE(SUM(worked_n::int),0)::int,'o',COALESCE(SUM(worked_o::int),0)::int) FROM classified) AS worked,
    COALESCE((SELECT jsonb_agg(p ORDER BY p.id) FROM (SELECT * FROM selected ORDER BY id LIMIT 25 OFFSET ${offset}) p),'[]'::jsonb) AS rows`,params);

  result.rows = await attachHistory(db,result.rows);
  return {enabled:true,...result,period:dates,page,page_size:25};
}

async function attachHistory(db, rows) {
  // One bounded history query for the page, not one request/query per card.
  if (rows.length) {
    const {rows:history} = await db.query(`SELECT * FROM (
      SELECT id,lead_id,event_type,occurred_at,recorded_at,primary_status,new_state,source,
        ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY recorded_at DESC,id DESC) AS rank,
        COUNT(*) OVER (PARTITION BY lead_id)::int AS history_total
      FROM counselor_workflow_events WHERE lead_id=ANY($1::uuid[])
        AND event_type IN ('workflow_enrolled','assignment_changed','remark_saved','legacy_activity_observed','legacy_state_changed','entered_old','entered_pending')
    ) h WHERE rank<=8 ORDER BY lead_id,recorded_at,id`,[rows.map(row => row.id)]);
    const grouped = new Map();
    for (const row of history) { if (!grouped.has(row.lead_id)) grouped.set(row.lead_id,[]); grouped.get(row.lead_id).push(row); }
    rows = rows.map(row => ({...row,history:grouped.get(row.id)||[],history_total:grouped.get(row.id)?.[0]?.history_total||0}));
  }
  return rows;
}

module.exports = {workspace,period,TABS,attachHistory};
