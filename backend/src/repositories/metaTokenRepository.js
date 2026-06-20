const { query } = require('../config/database');
const { encrypt, decrypt } = require('../utils/secretsCrypto');

async function findActivePageByPageId(pageId) {
  const { rows } = await query(
    `SELECT id, page_id, page_name, page_access_token, is_active,
            token_is_valid, token_last_checked, token_last_error,
            webhook_subscribed, webhook_last_checked, forms_status,
            forms_last_checked, stale_at
       FROM meta_pages
      WHERE page_id = $1 AND is_active = TRUE
      LIMIT 1`,
    [String(pageId)]
  );
  return rows[0] || null;
}

async function findActivePages() {
  const { rows } = await query(
    `SELECT id, page_id, page_name, page_access_token, is_active,
            token_is_valid, token_last_checked, token_last_error,
            webhook_subscribed, webhook_last_checked, forms_status,
            forms_last_checked, stale_at
       FROM meta_pages
      WHERE is_active = TRUE
      ORDER BY page_name NULLS LAST, page_id`
  );
  return rows;
}

async function findPageForForm(formId) {
  const { rows } = await query(
    `SELECT f.form_id, f.page_id, p.page_name, p.page_access_token,
            p.token_is_valid, p.token_last_checked, p.token_last_error
       FROM meta_forms f
       JOIN meta_pages p ON p.page_id = f.page_id AND p.is_active = TRUE
      WHERE f.form_id = $1 AND f.is_active = TRUE
      LIMIT 1`,
    [String(formId)]
  );
  return rows[0] || null;
}

async function savePageToken({ pageId, pageName, token }) {
  const { rows } = await query(
    `INSERT INTO meta_pages(page_id, page_name, page_access_token, is_active,
                            token_is_valid, token_last_checked, token_last_error,
                            token_source, stale_at, deactivated_at)
     VALUES ($1, $2, $3, TRUE, TRUE, NOW(), NULL, 'db_page_token', NULL, NULL)
     ON CONFLICT (page_id) DO UPDATE
       SET page_name = COALESCE(EXCLUDED.page_name, meta_pages.page_name),
           page_access_token = EXCLUDED.page_access_token,
           is_active = TRUE,
           token_is_valid = TRUE,
           token_last_checked = NOW(),
           token_last_error = NULL,
           token_source = 'db_page_token',
           stale_at = NULL,
           deactivated_at = NULL,
           updated_at = NOW()
     RETURNING id, page_id, page_name, is_active, token_is_valid, token_last_checked`,
    [String(pageId), pageName || null, token]
  );
  return rows[0];
}

async function updatePageHealth(pageId, { valid, error = null }) {
  await query(
    `UPDATE meta_pages
        SET token_is_valid = $1,
            token_last_checked = NOW(),
            token_last_error = $2,
            updated_at = NOW()
      WHERE page_id = $3`,
    [valid, error ? String(error).slice(0, 500) : null, String(pageId)]
  );
}

async function updatePageWebhookStatus(pageId, { subscribed, error = null }) {
  await query(
    `UPDATE meta_pages
        SET webhook_subscribed = $1,
            webhook_last_checked = NOW(),
            token_last_error = CASE WHEN $2::text IS NULL THEN token_last_error ELSE $2 END,
            updated_at = NOW()
      WHERE page_id = $3`,
    [!!subscribed, error ? String(error).slice(0, 500) : null, String(pageId)]
  );
}

async function updatePageFormsStatus(pageId, { status, error = null, synced = false }) {
  await query(
    `UPDATE meta_pages
        SET forms_status = $1,
            forms_last_checked = NOW(),
            token_last_error = CASE WHEN $2::text IS NULL THEN token_last_error ELSE $2 END,
            last_synced_at = CASE WHEN $3 THEN NOW() ELSE last_synced_at END,
            updated_at = NOW()
      WHERE page_id = $4`,
    [status, error ? String(error).slice(0, 500) : null, !!synced, String(pageId)]
  );
}

async function markPagesStaleExcept(pageIds) {
  const ids = (pageIds || []).map(String);
  const { rows } = await query(
    `UPDATE meta_pages
        SET is_active = FALSE,
            stale_at = COALESCE(stale_at, NOW()),
            updated_at = NOW()
      WHERE is_active = TRUE
        AND NOT (page_id = ANY($1::varchar[]))
      RETURNING page_id, page_name`,
    [ids]
  );
  return rows;
}

async function deactivatePage(pageId, userId = null) {
  const { rows } = await query(
    `UPDATE meta_pages
        SET is_active = FALSE,
            deactivated_at = NOW(),
            deactivated_by = $2,
            updated_at = NOW()
      WHERE page_id = $1
      RETURNING id, page_id, page_name, is_active, deactivated_at`,
    [String(pageId), userId]
  );
  return rows[0] || null;
}

async function getStoredUserTokenRecord() {
  let row;
  try {
    const result = await query(
      `SELECT id, config, secrets_encrypted, updated_at
         FROM integration_configs
        WHERE kind = 'meta' AND is_active = TRUE
          AND COALESCE(purpose, '') = 'oauth'
        ORDER BY updated_at DESC
        LIMIT 1`
    );
    row = result.rows[0];
  } catch {
    return null;
  }
  if (!row?.secrets_encrypted) return null;
  try {
    const secrets = decrypt(row.secrets_encrypted);
    const token = secrets?.user_access_token || secrets?.userAccessToken || null;
    if (!token) return null;
    return { token, config: row.config || {}, updated_at: row.updated_at, id: row.id };
  } catch {
    return null;
  }
}

async function getStoredUserToken() {
  const record = await getStoredUserTokenRecord();
  return record?.token || null;
}

async function saveUserToken(token, updatedByUserId = null, metadata = {}) {
  const encrypted = encrypt({ user_access_token: token });
  const config = {
    token_status: metadata.status || 'valid',
    token_last_checked: metadata.last_checked || new Date().toISOString(),
    token_last_error: metadata.error || null,
    token_expires_at: metadata.expires_at || null,
    permissions: metadata.permissions || [],
  };
  const updated = await query(
    `UPDATE integration_configs
        SET secrets_encrypted = $1, config = $2::jsonb, is_active = TRUE, updated_at = NOW()
      WHERE kind = 'meta' AND purpose = 'oauth' AND is_active = TRUE
      RETURNING id`,
    [encrypted, JSON.stringify(config)]
  );
  if (updated.rows[0]) return updated.rows[0];
  const { rows } = await query(
    `INSERT INTO integration_configs
       (kind, label, purpose, config, secrets_encrypted, is_active, created_by_user_id)
     VALUES ('meta', 'Meta OAuth', 'oauth', $1::jsonb, $2, TRUE, $3)
     RETURNING id`,
    [JSON.stringify(config), encrypted, updatedByUserId]
  );
  return rows[0];
}

async function updateUserTokenStatus(metadata = {}) {
  await query(
    `UPDATE integration_configs
        SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE kind = 'meta' AND purpose = 'oauth' AND is_active = TRUE`,
    [JSON.stringify({
      token_status: metadata.status || null,
      token_last_checked: new Date().toISOString(),
      token_last_error: metadata.error || null,
      token_expires_at: metadata.expires_at || null,
      permissions: metadata.permissions || undefined,
    })]
  );
}

module.exports = {
  findActivePageByPageId,
  findActivePages,
  findPageForForm,
  savePageToken,
  updatePageHealth,
  updatePageWebhookStatus,
  updatePageFormsStatus,
  markPagesStaleExcept,
  deactivatePage,
  getStoredUserTokenRecord,
  getStoredUserToken,
  saveUserToken,
  updateUserTokenStatus,
};
