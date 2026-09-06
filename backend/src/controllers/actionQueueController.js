const { asyncHandler } = require('../utils/errors');
const logger = require('../utils/logger');
const actionQueue = require('../services/actionQueueService');

exports.list = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const data = await actionQueue.listActionQueue(req.user, req.query);
    logger.info({
      actor_role: req.user?.role,
      queue_type: req.query.type || 'all',
      duration_ms: Date.now() - startedAt,
      result_count: data.rows.length,
    }, 'Action queue request completed');
    res.json({ success: true, data });
  } catch (error) {
    logger.error({
      actor_role: req.user?.role,
      queue_type: req.query.type || 'all',
      duration_ms: Date.now() - startedAt,
      error_code: error.code || null,
      error_message: error.message,
    }, 'Action queue request failed');
    throw error;
  }
});
