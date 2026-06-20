-- 041: Explicit Meta page selection / allowlist.
-- Discovered pages remain inert until an administrator activates them.

ALTER TABLE meta_pages
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'discovered',
  ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

-- Preserve pages already selected by the existing production configuration.
UPDATE meta_pages
   SET connection_status = CASE
         WHEN is_active = TRUE THEN 'active'
         WHEN stale_at IS NOT NULL THEN 'stale'
         WHEN deactivated_at IS NOT NULL THEN 'deactivated'
         ELSE 'discovered'
       END,
       selected_at = CASE
         WHEN is_active = TRUE THEN COALESCE(selected_at, updated_at, created_at, NOW())
         ELSE selected_at
       END
 WHERE connection_status = 'discovered';

CREATE INDEX IF NOT EXISTS idx_meta_pages_connection_status
  ON meta_pages(connection_status, is_active);
