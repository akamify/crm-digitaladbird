const { asyncHandler } = require('../utils/errors');
const logger = require('../utils/logger');
const analytics = require('../services/leadDistributionAnalyticsService');

function monitored(endpoint, operation) {
  return asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    const context = {
      endpoint,
      actor_role: req.user?.role,
      view: req.query.view || 'all_time',
      from: req.query.from || null,
      to: req.query.to || null,
    };
    logger.info(context, 'Lead distribution analytics request started');
    try {
      const data = await operation(req);
      logger.info({ ...context, duration_ms: Date.now() - startedAt }, 'Lead distribution analytics request completed');
      res.json({ success: true, data });
    } catch (error) {
      logger.error({
        ...context,
        duration_ms: Date.now() - startedAt,
        error_code: error.code || null,
        error_message: error.message,
      }, 'Lead distribution analytics request failed');
      throw error;
    }
  });
}

exports.rms = monitored('/leads/distribution/rms', req => analytics.listRms(req.user, req.query));
exports.counselors = monitored('/leads/distribution/rms/:rmId/counselors', req => (
  analytics.listCounselors(req.user, req.params.rmId, req.query)
));
exports.counselorLeads = monitored('/leads/distribution/rms/:rmId/counselors/:counselorId/leads', req => (
  analytics.getCounselorLeads(req.user, req.params.rmId, req.params.counselorId, req.query)
));
