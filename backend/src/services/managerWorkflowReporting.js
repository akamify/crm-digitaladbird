const { query } = require('../config/database');
const { AppError } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');
const { CALL_ISSUE_STATUSES } = require('./counselorWorkflowPolicies');
const { leadListSql } = require('./leadListQuery');
const { applyLeadDisplayName } = require('./leadNameService');
const { CALL_ISSUE_LABELS } = require('../constants/counselorReportOptions');

const METRICS = ['received','new','old','worked','pending','cc','responded','call_issues','common_meeting','dim',
  'personal_meeting','follow_up','quotation','hot','warm','special_category','call_reminder','handover_rm',
  'not_attended','converted','cold','process_incomplete','responses','tte','worked_n','worked_o','worked_legacy'];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function metric(value) {
  const key = value === 'session_9pm' ? 'common_meeting' : value === 'all' ? 'received' : value || 'received';
  if (!METRICS.includes(key)) throw new AppError(400,'INVALID_WORKFLOW_VIEW','Select a supported workflow view.');
  return key;
}
function summary(alias='f') {
  return METRICS.map(key=>`COUNT(DISTINCT ${alias}.id) FILTER(WHERE ${alias}.metric_${key})::int AS ${key}`).join(',') + `,COUNT(DISTINCT ${alias}.id) FILTER(WHERE ${alias}.metric_common_meeting)::int AS session_9pm`;
}
async function context(actor,input={}) {
  if (!['super_admin','admin','rm'].includes(actor.role)) throw new AppError(403,'FORBIDDEN','Manager reporting requires manager access.');
  const analytics = require('./leadDistributionAnalyticsService');
  const lifecycle = require('./lifecycleService');
  const scope = analytics.normalizeScope({...input,view:input.lead_view || input.view || 'all_time'});
  const selected = metric(input.workflow_view || input.metric);
  const source = input.work_source || '';
  if(source && !['new','old','previous'].includes(source)) throw new AppError(400,'INVALID_WORK_SOURCE','Select New, Old or Previous work.');
  const issue = input.call_issue_type || '';
  if(issue && !CALL_ISSUE_STATUSES.includes(issue)) throw new AppError(400,'INVALID_CALL_ISSUE','Select a supported call issue.');
  if(input.assigned_to && !['__assigned','__unassigned','assigned','unassigned'].includes(input.assigned_to) && !UUID.test(input.assigned_to)) throw new AppError(400,'INVALID_COUNSELOR_ID','Invalid assignee.');
  const rmId = input.rm_id || (actor.role==='rm' ? actor.id : null);
  const counselorId = input.counselor_id || (UUID.test(input.assigned_to || '') ? input.assigned_to : null);
  let rm=null,counselor=null;
  if(rmId) rm=await analytics.assertRmAccess(actor,rmId);
  if(counselorId) {
    if(!UUID.test(counselorId)) throw new AppError(400,'INVALID_COUNSELOR_ID','Invalid counselor.');
    const {rows:[person]}=await query("SELECT id,report_to_id FROM users WHERE id=$1 AND role::text IN ('member','partner') AND deleted_at IS NULL",[counselorId]);
    if(!person?.report_to_id) throw new AppError(404,'COUNSELOR_NOT_FOUND','Counselor has no accessible RM.');
    ({rm,counselor}=await analytics.assertCounselorAccess(actor,rmId || person.report_to_id,counselorId));
  }
  const visible=await getVisibleUserIds(actor);
  const params=[scope.from,scope.to,visible,lifecycle.QUALIFYING_EVENTS];
  const add=value=>{params.push(value);return `$${params.length}`;};
  const filters=analytics.buildAnalyticsFilters({...input,assigned_to:counselorId ? undefined : input.assigned_to},params,'l');
  const access="AND ($3::uuid[] IS NULL OR l.assigned_to_user_id=ANY($3::uuid[]) OR (l.assigned_to_user_id IS NULL AND l.pool_rm_id=ANY($3::uuid[])) OR EXISTS(SELECT 1 FROM lead_assignments visible_history WHERE visible_history.lead_id=l.id AND visible_history.previous_user_id=ANY($3::uuid[])))";
  const base=lifecycle.workspaceCte(scope,access,filters.join(' AND '),true,'report_actor.id',true);
  const views=lifecycle.counselorJourneyViews('reporting_actor_id');
  // Received retains its original created-date cohort, including unassigned leads.
  views.received=`assigned_to_user_id IS NOT DISTINCT FROM reporting_actor_id AND ${scope.view==='all_time'?'TRUE':"created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')"}`;
  const flags=METRICS.map(key=>`COALESCE((${views[key]}),FALSE) AS metric_${key}`).join(',');
  const scopeClauses=['TRUE'];
  if(rm) scopeClauses.push(`f.distribution_rm_id=${add(rm.id)}::uuid`);
  if(counselor) scopeClauses.push(`f.distribution_counselor_id=${add(counselor.id)}::uuid`);
  const cte=`${base}, attributed AS MATERIALIZED (
    SELECT c.*,${flags},
      CASE WHEN rm.role::text='rm' AND rm.deleted_at IS NULL THEN rm.id END AS distribution_rm_id,
      CASE WHEN u.role::text IN ('member','partner') AND u.deleted_at IS NULL AND u.status::text='active' AND u.report_to_id=rm.id THEN u.id END AS distribution_counselor_id,
      CASE WHEN c.workflow_managed THEN c.workflow_primary_status ELSE c.last_call_result END AS effective_call_issue
    FROM classified c LEFT JOIN users u ON u.id=c.reporting_actor_id
    LEFT JOIN users rm ON rm.id=CASE WHEN u.role::text='rm' THEN u.id WHEN u.role::text IN ('member','partner') THEN COALESCE(u.report_to_id,c.pool_rm_id) ELSE c.pool_rm_id END
  ), report_scope AS MATERIALIZED (SELECT f.* FROM attributed f WHERE ${scopeClauses.join(' AND ')})`;
  let predicate=`f.metric_${selected}`;
  if(selected==='worked' && source) predicate+=` AND f.metric_worked_${source==='previous'?'legacy':source==='new'?'n':'o'}`;
  if(selected==='call_issues' && issue) predicate+=` AND f.effective_call_issue=${add(issue)}`;
  return {scope,selected,rm,counselor,params,cte,predicate,add,visible};
}
async function report(actor,input={}) {
  const c=await context(actor,input);
  const page=Math.min(100000,Math.max(1,parseInt(input.page,10)||1));
  const pageSize=Math.min(100,Math.max(1,parseInt(input.page_size,10)||25));
  const limit=c.add(pageSize),offset=c.add((page-1)*pageSize);
  const {rows:[result]}=await query(`${c.cte}, matched AS MATERIALIZED (
    SELECT f.id,BOOL_OR(f.metric_worked_n) AS worked_n,BOOL_OR(f.metric_worked_o) AS worked_o,
      BOOL_OR(f.metric_worked_legacy) AS legacy_worked,BOOL_OR(f.metric_call_issues) AS has_call_issue,MAX(f.effective_call_issue) AS effective_call_issue FROM report_scope f WHERE ${c.predicate} GROUP BY f.id
  ), page_ids AS MATERIALIZED (
    SELECT m.* FROM matched m JOIN leads l ON l.id=m.id ORDER BY l.created_at DESC,l.id DESC LIMIT ${limit} OFFSET ${offset}
  ), page_rows AS (
    SELECT c.*,u.full_name AS assigned_to_name,m.worked_n,m.worked_o,m.legacy_worked,m.has_call_issue,m.effective_call_issue,COALESCE(attempt_history.attempts,'[]'::jsonb) AS attempts,
      ${require('./distributionLeadEvidence').fields},
      cw.primary_status AS workflow_primary_status,cw.queue AS workflow_queue,
      COALESCE(cw.move_to_old_at,cw.move_to_pending_at) AS workflow_deadline,
      CASE WHEN cw.followup_override THEN NULL WHEN cw.move_to_old_at IS NOT NULL THEN 'old' WHEN cw.move_to_pending_at IS NOT NULL THEN 'pending' END AS workflow_next_queue,
      COALESCE(latest_remark.remark,'') AS current_remark,latest_remark.call_status::text AS latest_remark_status,latest_remark.created_at AS latest_remark_at,
      FALSE AS read_only_access
    FROM page_ids m JOIN leads c ON c.id=m.id LEFT JOIN users u ON u.id=c.assigned_to_user_id
    LEFT JOIN counselor_workflow_state cw ON cw.lead_id=c.id AND cw.assigned_to_user_id=c.assigned_to_user_id AND cw.assignment_at IS NOT DISTINCT FROM c.assigned_at
    LEFT JOIN LATERAL(SELECT remark,call_status,created_at FROM lead_remarks WHERE lead_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) latest_remark ON TRUE
    ${require('./distributionLeadEvidence').joins}
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(to_jsonb(attempt)), '[]'::jsonb) AS attempts
      FROM (${require('./distributionLeadEvidence').attemptsSql('ca.lead_id=c.id')}) attempt
    ) attempt_history ON m.has_call_issue
  ), hydrated_rows AS (${leadListSql({whereSql:'l.id IN (SELECT id FROM page_rows)',limitIdx:c.params.length-1,offsetIdx:null,readOnly:false})}) SELECT (SELECT to_jsonb(s) FROM (SELECT ${summary()} FROM report_scope f) s) AS summary,
    (SELECT COUNT(*)::int FROM matched) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(p) || to_jsonb(d) || jsonb_build_object('read_only_access',($3::uuid[] IS NOT NULL AND (p.assigned_to_user_id IS NULL OR NOT p.assigned_to_user_id=ANY($3::uuid[])))) ORDER BY p.created_at DESC,p.id DESC) FROM page_rows p JOIN hydrated_rows d ON d.id=p.id),'[]'::jsonb) AS rows,
    COALESCE((SELECT jsonb_object_agg(issue,n) FROM (SELECT effective_call_issue AS issue,COUNT(DISTINCT id)::int AS n FROM report_scope WHERE metric_call_issues AND effective_call_issue IS NOT NULL GROUP BY effective_call_issue) buckets),'{}'::jsonb) AS call_issue_buckets`,c.params);
  result.rows=result.rows.map(row=>applyLeadDisplayName(row));
  result.summary.session_9pm=result.summary.common_meeting;
  return {...result,scope:c.scope,rm:c.rm,counselor:c.counselor,metric:c.selected,page,page_size:pageSize,call_issue_labels:CALL_ISSUE_LABELS};
}
async function people(actor,input,kind) {
  const c=await context(actor,{...input,call_issue_type:undefined,work_source:undefined});
  const role=kind==='rms'?"u.role::text='rm'":"u.role::text IN ('member','partner')";
  const personScope=kind==='rms'?(actor.role==='rm'?`u.id=${c.add(actor.id)}::uuid`:'TRUE'):`u.report_to_id=${c.add(c.rm.id)}::uuid`;
  const search=input.search ? ` AND u.full_name ILIKE ${c.add(`%${input.search}%`)}`:'';
  const group=kind==='rms'?'distribution_rm_id':'distribution_counselor_id';
  const sort=['received','new','old','worked','pending','converted','call_issues'].includes(input.sort)?input.sort:'received';
  const order=input.sort==='name'?'full_name ASC':`${sort} ${input.order==='asc'?'ASC':'DESC'},full_name ASC`;
  const {rows:[result]}=await query(`${c.cte}, cards AS (
    SELECT u.id,u.full_name,u.team_name,${summary()},
      (SELECT COUNT(*)::int FROM users m WHERE m.report_to_id=u.id AND m.role::text IN ('member','partner') AND m.deleted_at IS NULL AND m.status::text='active') AS counselor_count
    FROM users u LEFT JOIN report_scope f ON f.${group}=u.id
    WHERE ${role} AND u.deleted_at IS NULL AND u.status::text='active' AND ${personScope}${search} GROUP BY u.id
  ) SELECT (SELECT to_jsonb(s) FROM (SELECT ${summary()} FROM report_scope f) s) AS summary,
    COALESCE((SELECT jsonb_agg(to_jsonb(cards) ORDER BY ${order}) FROM cards),'[]'::jsonb) AS cards,
    (SELECT to_jsonb(s) FROM (SELECT ${summary()} FROM report_scope f WHERE f.${group} IS NULL) s) AS unassigned`,c.params);
  return {scope:c.scope,rm:c.rm,summary:result.summary,[kind]:result.cards.map(card=>({...card,distribution_share:result.summary.received?Math.round(card.received/result.summary.received*10000)/100:0,work_rate:card.received?Math.round(card.worked/card.received*10000)/100:0})),unassigned:{id:null,full_name:'Unassigned',...result.unassigned}};
}
module.exports={context,report,metric,METRICS,
  rms:(actor,input)=>people(actor,input,'rms'),
  counselors:(actor,rmId,input)=>people(actor,{...input,rm_id:rmId},'counselors'),
  counselorLeads:(actor,rmId,counselorId,input)=>report(actor,{...input,rm_id:rmId,counselor_id:counselorId})};
