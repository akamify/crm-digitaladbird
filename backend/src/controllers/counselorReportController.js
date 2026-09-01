const { asyncHandler } = require('../utils/errors');
const logger = require('../utils/logger');
const report = require('../services/counselorReportService');

function reportFilters(query = {}) {
  const filterKeys = ['from', 'to', 'source', 'category', 'stage', 'campaign', 'counselor', 'counselor_id', 'rm', 'rm_id', 'team'];
  return {
    from: query.from || null,
    to: query.to || null,
    supplied_filter_keys: filterKeys.filter(key => Boolean(query[key])),
  };
}

function monitored(name, operation) {
  return asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    const context = { endpoint: `/counselor-report/${name}`, ...reportFilters(req.query) };
    logger.info(context, 'Counselor report request started');
    try {
      const data = await operation(req.query);
      logger.info({ ...context, duration_ms: Date.now() - startedAt }, 'Counselor report request completed');
      return res.json({ success: true, data });
    } catch (err) {
      logger.error({
        ...context,
        duration_ms: Date.now() - startedAt,
        pg_code: err.code || null,
        pg_message: err.message || null,
        pg_detail: err.detail || null,
      }, 'Counselor report request failed');
      throw err;
    }
  });
}

exports.summary = monitored('summary', query => report.summary(query));
exports.counselors = monitored('counselors', query => report.getCounselorRows(query));
exports.teams = monitored('rm-teams', query => report.teams(query));
exports.filters = asyncHandler(async (_req, res) => res.json({ success: true, data: await report.filters() }));
exports.leads = monitored('leads', query => report.drilldown(query));
