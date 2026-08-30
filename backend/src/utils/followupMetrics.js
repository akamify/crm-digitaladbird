function remarkHasFollowupActivityCondition(alias = 'lr') {
  const remark = String(alias || 'lr').trim();
  return `(
    ${remark}.next_followup_at IS NOT NULL
    OR COALESCE(${remark}.call_status::text, '') = 'follow_up'
    OR COALESCE(${remark}.call_statuses, '[]'::jsonb) ? 'follow_up'
  )`;
}

function leadHasFollowupActivityCondition(alias = 'l', remarkAlias = 'lr_followup') {
  const lead = String(alias || 'l').trim();
  const followupRemark = String(remarkAlias || 'lr_followup').trim();
  return `(
    ${lead}.next_followup_at IS NOT NULL
    OR COALESCE(${lead}.call_status::text, '') = 'follow_up'
    OR EXISTS (
      SELECT 1
        FROM lead_remarks ${followupRemark}
       WHERE ${followupRemark}.lead_id = ${lead}.id
         AND ${remarkHasFollowupActivityCondition(followupRemark)}
    )
  )`;
}

module.exports = {
  remarkHasFollowupActivityCondition,
  leadHasFollowupActivityCondition,
};
