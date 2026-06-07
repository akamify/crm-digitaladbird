-- DigitalADbird CRM — Meta integration CONFIG seed (no secrets, no PII)
-- Generated: 2026-06-07T13:43:36.989Z
-- Source: localhost
--
-- IDEMPOTENT — safe to run multiple times. Uses ON CONFLICT DO NOTHING.
-- NO truncates. NO wipes. NO secrets. NO lead PII.
--
-- Apply on VPS:
--   psql "$DATABASE_URL" -f backend/src/db/seeds/meta-config-seed.sql
--
-- AFTER applying:
--   1. CRM UI → Meta Pages → each page → "Update Token" (paste token)
--   2. scp google-service-account.json to VPS backend/credentials/
--   3. cd backend && BACKFILL_DAYS=7 node scripts/recover-meta-leads.js
--      (pulls leads from Meta directly, no PII transits git)

BEGIN;

-- meta_pages: 6 rows (excluded cols: page_access_token, access_token, user_access_token)
INSERT INTO "meta_pages" ("id","page_id","page_name","is_active","created_at","updated_at") VALUES
  ('09b2fac8-8bb4-4af2-b7a3-e189e0133ca0','911997565330440','Digital Ad',TRUE,'2026-06-04T06:08:17.461Z'::timestamptz,'2026-06-04T06:09:13.319Z'::timestamptz),
  ('63f2c4b2-cd5e-4a2f-9b2d-7da29923d620','916888448166514','Digital Ad Bird',TRUE,'2026-06-04T06:08:17.667Z'::timestamptz,'2026-06-04T06:09:13.807Z'::timestamptz),
  ('b829e9f2-7bcd-40ef-85f0-0ba819548656','220342467819979','Digital AdBird',FALSE,'2026-05-18T11:19:41.589Z'::timestamptz,'2026-06-04T06:09:49.724Z'::timestamptz),
  ('91bc6958-a435-451f-b974-4ec97b68949b','61584290600066','Digital Ad Bird',FALSE,'2026-05-16T08:06:57.257Z'::timestamptz,'2026-06-04T06:09:49.724Z'::timestamptz),
  ('b57080f7-059f-4cd2-bc6e-3ab3f6a84267','2278433049268770','DigitalADbird Lead Ads (deactivated)',FALSE,'2026-06-02T09:49:10.453Z'::timestamptz,'2026-06-04T06:09:49.724Z'::timestamptz),
  ('fbd4bc35-6c3b-430d-9086-6ff218b8e258','122183309462789545','Rajesh Kumar Yadav',FALSE,'2026-06-02T10:04:18.724Z'::timestamptz,'2026-06-04T06:09:49.724Z'::timestamptz)
ON CONFLICT (page_id) DO NOTHING;

-- meta_forms: 4 rows (excluded cols: none)
INSERT INTO "meta_forms" ("id","form_id","form_name","page_id","campaign_label","product_tag","is_active","created_at") VALUES
  ('593f7d64-6471-4e39-8858-b9315622c4f3','1428595009034272','Simple form setup 28/05/2026, 16:16:36','916888448166514',NULL,NULL,TRUE,'2026-06-04T06:10:01.397Z'::timestamptz),
  ('03b26e2a-f891-4a1c-956e-baaa418504bd','2479152785870029','digital marketing form 1','916888448166514',NULL,NULL,TRUE,'2026-06-04T06:10:01.402Z'::timestamptz),
  ('538fbeab-8576-4aec-856f-47f2d238c9a8','1595789028146834','LF 2','916888448166514',NULL,NULL,TRUE,'2026-06-04T06:10:01.404Z'::timestamptz),
  ('a8bffb82-0c6f-4d64-8a9c-6af13ca76feb','4300995410168482','LF 1','916888448166514',NULL,NULL,TRUE,'2026-06-04T06:10:01.407Z'::timestamptz)
ON CONFLICT (form_id) DO NOTHING;

-- meta_campaigns: 4 rows (excluded cols: none)
INSERT INTO "meta_campaigns" ("id","campaign_id","campaign_name","internal_label","ad_account_id","category","description","is_active","created_at","updated_at") VALUES
  ('56591246-73cf-4eaf-9671-7e79c66191a6','manual_1779449862597','ABHI SINGH','RAD','12343','partner',NULL,FALSE,'2026-05-22T11:37:42.598Z'::timestamptz,'2026-05-27T07:31:53.703Z'::timestamptz),
  ('e74bc827-f4cf-4804-a1a6-089dd5b55f86','120243611807400382','LCT180426','LCT180426',NULL,'partner',NULL,TRUE,'2026-06-04T06:10:19.015Z'::timestamptz,'2026-06-04T06:10:19.015Z'::timestamptz),
  ('fa9a0ca0-96af-44c6-8963-32836189a8e2','120243668525510382','LCT200426','LCT200426',NULL,'partner',NULL,TRUE,'2026-06-04T06:53:42.266Z'::timestamptz,'2026-06-04T06:53:42.266Z'::timestamptz),
  ('8b58ddf8-1322-4a76-8855-968c7c277429','manual_1779449863729','ABHI SINGH','RAD','12343','partner',NULL,FALSE,'2026-05-22T11:37:43.730Z'::timestamptz,'2026-06-05T10:53:56.842Z'::timestamptz)
ON CONFLICT (campaign_id) DO NOTHING;

-- meta_ad_accounts: 2 rows (excluded cols: access_token)
INSERT INTO "meta_ad_accounts" ("id","account_id","account_name","is_active","created_at") VALUES
  ('0d148770-eed7-4db0-9c93-f66d666983e4','act_4427126714020065','Ad Account act_4427126714020065',TRUE,'2026-05-18T11:19:41.613Z'::timestamptz),
  ('f50bae30-6fc5-4431-b34e-e3d525b60bd8','act_5090581587834677','Ad Account act_5090581587834677',TRUE,'2026-05-18T11:19:41.617Z'::timestamptz)
ON CONFLICT (account_id) DO NOTHING;

-- distribution_settings: 5 rows (excluded cols: none)
INSERT INTO "distribution_settings" ("key","value","label","updated_at") VALUES
  ('distribution_timezone','Asia/Kolkata','Timezone for distribution window','2026-05-15T15:55:47.805Z'::timestamptz),
  ('pending_block_threshold','3','Block distribution when member has this many unworked leads','2026-05-16T07:33:07.269Z'::timestamptz),
  ('auto_distribution_enabled','true','Enable automatic lead distribution','2026-06-06T08:50:42.390Z'::timestamptz),
  ('distribution_start_hour','8','Distribution start time (IST hour, 0-23)','2026-06-06T09:01:30.733Z'::timestamptz),
  ('distribution_end_hour','19','Distribution end time   (IST hour, 0-23)','2026-06-06T09:01:30.735Z'::timestamptz)
ON CONFLICT (key) DO NOTHING;

-- distribution_rules: 1 rows (excluded cols: none)
INSERT INTO "distribution_rules" ("id","name","form_id","strategy","eligible_user_ids","priority","is_active","created_at","updated_at") VALUES
  ('56f23bc0-7e84-4351-ad38-19a00b47fea9','Default Round Robin',NULL,'round_robin','[]'::jsonb,100,FALSE,'2026-05-15T14:46:50.994Z'::timestamptz,'2026-06-05T11:17:39.571Z'::timestamptz)
ON CONFLICT (id) DO NOTHING;

COMMIT;
