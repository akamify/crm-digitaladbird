-- Set the database default timezone to Asia/Kolkata.
--
-- Why: ~25 'today' filters used `created_at::date = CURRENT_DATE`. That
-- depends on session tz. On a UTC server, late-night IST leads got the
-- wrong date. The per-connection SET TIME ZONE in pool.on('connect') AND
-- the IST-explicit SQL filters together already guarantee correctness —
-- this migration is a third belt: makes the DB default sane too.
--
-- IMPORTANT: ALTER DATABASE requires being the DB owner (or superuser).
-- If the role running migrations doesn't have permission, that's fine —
-- the other two layers cover it. We wrap in a DO block so a permission
-- error logs a NOTICE instead of failing the whole migration (which
-- would block the deploy and leave the backend running stale code).

DO $migration$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L',
                 current_database(), 'Asia/Kolkata');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipped ALTER DATABASE: current role is not the DB owner. The pool.on(connect) SET TIME ZONE hook in src/config/database.js still pins every connection to IST.';
END
$migration$;
