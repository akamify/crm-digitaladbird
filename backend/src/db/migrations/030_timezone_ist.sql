-- Set the database session timezone to Asia/Kolkata.
--
-- Why: ~25 'today' filters across the codebase use
-- `created_at::date = CURRENT_DATE`. `CURRENT_DATE` is calculated in the
-- connection's timezone. On a UTC server, a Meta lead arriving at 01:30 IST
-- (= 20:00 UTC of the previous day) counts as YESTERDAY for any UTC-tz
-- session — so the "Today Fresh Leads" tile silently drops late-night IST
-- traffic. Setting the database default to IST makes every NEW connection
-- treat 'today' as the calendar day in India.
--
-- Existing pooled connections keep their old timezone until reconnected,
-- so a backend restart (pm2 restart crm-backend) is required after this.

ALTER DATABASE current_database() SET timezone = 'Asia/Kolkata';
