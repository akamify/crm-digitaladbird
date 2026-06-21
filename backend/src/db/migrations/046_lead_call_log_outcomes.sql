-- 046: Allow CRM lead-call outcome statuses in lead_call_logs.
-- The call provider still uses initiated/ringing/etc.; profile call logging can
-- store business outcomes that are then synced to leads.call_status.

ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'talk_response';
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'custom_remark';

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = con.connamespace
   WHERE nsp.nspname = current_schema()
     AND rel.relname = 'lead_call_logs'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%status%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE lead_call_logs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE lead_call_logs
  ADD CONSTRAINT lead_call_logs_status_check
  CHECK (status IN (
    'initiated','ringing','connected','completed','failed','missed','cancelled',
    'answered','interested','talk_response','not_answered','no_answer','rnr','cnr',
    'busy','switched_off','so','callback_requested','callback','ccb','follow_up',
    'converted','not_interested','ni','wrong_number','invalid_number',
    'language_barrier','custom_remark'
  ));
