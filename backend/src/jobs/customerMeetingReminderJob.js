const logger = require('../utils/logger');
const { processPendingMeetingNotifications } = require('../services/customerMeetingNotificationService');

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await processPendingMeetingNotifications();
  } catch (error) {
    logger.error({ err: error.message }, '[CustomerMeetingJob] tick failed');
  } finally {
    running = false;
  }
}

function startCustomerMeetingReminderJob() {
  logger.info('[CustomerMeetingJob] scheduler started (every 60s)');
  setTimeout(() => tick().catch(() => {}), 10_000);
  return setInterval(() => tick().catch(() => {}), 60_000);
}

module.exports = { startCustomerMeetingReminderJob };
