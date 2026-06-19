const { query } = require('../config/database');
const { encrypt, decrypt } = require('../utils/secretsCrypto');

async function findActivePageByPageId(pageId) {
  const { rows } = await query(
    `SELECT id, page_id, page_name, page_access_token, is_active,
            token_is_valid, token_last_checked, token_last_error
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
            token_is_valid, token_last_checked, token_last_error
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
                            token_is_valid, token_last_checked, token_last_error)
     VALUES ($1, $2, $3, TRUE, TRUE, NOW(), NULL)
     ON CONFLICT (page_id) DO UPDATE
       SET page_name = COALESCE(EXCLUDED.page_name, meta_pages.page_name),
           page_access_token = EXCLUDED.page_access_token,
           is_active = TRUE,
           token_is_valid = TRUE,
           token_last_checked = NOW(),
           token_last_error = NULL,
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

async function getStoredUserToken() {
  let row;
  try {
    const result = await query(
      `SELECT secrets_encrypted
         FROM integration_configs
        WHERE kind = 'meta' AND is_active = TRUE
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
    return secrets?.user_access_token || secrets?.userAccessToken || null;
  } catch {
    return null;
  }
}

async function saveUserToken(token, updatedByUserId = null) {
  const encrypted = encrypt({ user_access_token: token });
  const updated = await query(
    `UPDATE integration_configs
        SET secrets_encrypted = $1, is_active = TRUE, updated_at = NOW()
      WHERE kind = 'meta' AND purpose = 'oauth' AND is_active = TRUE
      RETURNING id`,
    [encrypted]
  );
  if (updated.rows[0]) return updated.rows[0];
  const { rows } = await query(
    `INSERT INTO integration_configs
       (kind, label, purpose, config, secrets_encrypted, is_active, created_by_user_id)
     VALUES ('meta', 'Meta OAuth', 'oauth', '{}'::jsonb, $1, TRUE, $2)
     RETURNING id`,
    [encrypted, updatedByUserId]
  );
  return rows[0];
}

module.exports = {
  findActivePageByPageId,
  findActivePages,
  findPageForForm,
  savePageToken,
  updatePageHealth,
  getStoredUserToken,
  saveUserToken,
};
