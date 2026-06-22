-- Scheduled lead assignment controls.
-- Auto distribution is deliberately off by default; admins must opt in.

INSERT INTO distribution_settings (key, value, label) VALUES
  ('auto_distribution_enabled', 'false', 'Enable scheduled automatic lead assignment'),
  ('auto_assign_enabled', 'false', 'Enable scheduled automatic lead assignment'),
  ('scheduled_assignment_time', '', 'Daily scheduled assignment time in HH:MM IST'),
  ('scheduled_timezone', 'Asia/Kolkata', 'Scheduled assignment timezone'),
  ('eligible_assignee_roles', 'member,partner', 'Roles eligible for direct lead assignment'),
  ('max_leads_per_scheduled_run', '100', 'Maximum leads assigned by one scheduled run'),
  ('last_scheduled_run_at', '', 'Last scheduled assignment run timestamp'),
  ('next_scheduled_run_at', '', 'Next scheduled assignment run timestamp'),
  ('is_distribution_running', 'false', 'Distribution scheduler lock'),
  ('last_distribution_status', '', 'Last distribution run status'),
  ('last_distribution_error', '', 'Last distribution run error')
ON CONFLICT (key) DO NOTHING;

UPDATE distribution_settings
   SET value = 'false', updated_at = NOW()
 WHERE key IN ('auto_distribution_enabled', 'auto_assign_enabled')
   AND NOT EXISTS (
     SELECT 1
       FROM distribution_settings configured_time
      WHERE configured_time.key = 'scheduled_assignment_time'
        AND NULLIF(TRIM(configured_time.value), '') IS NOT NULL
   );
