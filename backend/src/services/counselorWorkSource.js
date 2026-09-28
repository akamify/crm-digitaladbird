// Pending work belongs to O. Historical attribution uses recorded pre-work
// state only; never infer the source from a lead's current mutable queue.
function workSource(queue) {
  return queue === 'new' ? 'new' : ['old','pending'].includes(queue) ? 'old' : null;
}
function workSourceSql(alias='e') {
  return `CASE WHEN ${alias}.work_source IN ('new','old') THEN ${alias}.work_source
    WHEN ${alias}.work_source IS NULL AND ${alias}.previous_state->>'queue'='pending' THEN 'old' END`;
}
module.exports={workSource,workSourceSql};
