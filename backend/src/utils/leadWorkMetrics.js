function workedLeadCondition(alias = 'l') {
  const lead = String(alias || '').trim();
  return `(
    COALESCE(${lead}.call_status::text, 'not_called') <> 'not_called'
    OR ${lead}.last_call_at IS NOT NULL
    OR EXISTS (
      SELECT 1
        FROM lead_remarks worked_lr
       WHERE worked_lr.lead_id = ${lead}.id
    )
    OR EXISTS (
      SELECT 1
        FROM lead_workflow worked_wf
       WHERE worked_wf.lead_id = ${lead}.id
         AND (
           worked_wf.remark_status IS NOT NULL
           OR COALESCE(jsonb_array_length(worked_wf.step_1_statuses), 0) > 0
         )
    )
    OR EXISTS (
      SELECT 1
        FROM lead_call_logs worked_cl
       WHERE worked_cl.lead_id = ${lead}.id
    )
  )`;
}

function notWorkedLeadCondition(alias = 'l') {
  return `NOT ${workedLeadCondition(alias)}`;
}

module.exports = {
  workedLeadCondition,
  notWorkedLeadCondition,
};
