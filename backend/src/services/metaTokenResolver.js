const crypto = require('crypto');
const config = require('../config/env');
const { AppError } = require('../utils/errors');
const metaTokenRepository = require('../repositories/metaTokenRepository');
const { graphGet } = require('./metaGraphClient');

const PAGE_TOKEN_MISSING_MESSAGE = 'Page access token is missing. Update Meta token and reconnect this page.';
const PAGE_TOKEN_INVALID_MESSAGE = 'Page access token is invalid. Update Meta token and reconnect this page.';

function maskToken(token) {
  if (!token) return null;
  return {
    length: String(token).length,
    fingerprint: crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 10),
  };
}

async function getPageTokenByPageId(pageId) {
  const page = await metaTokenRepository.findActivePageByPageId(pageId);
  if (!page?.page_access_token) return null;
  return { token: page.page_access_token, page, source: 'db_page_token' };
}

async function getRequiredPageToken(pageId) {
  const resolved = await getPageTokenByPageId(pageId);
  if (!resolved) throw new AppError(409, 'META_PAGE_TOKEN_MISSING', PAGE_TOKEN_MISSING_MESSAGE, { page_id: String(pageId) });
  return resolved;
}

async function getPageTokenForForm(formId) {
  const page = await metaTokenRepository.findPageForForm(formId);
  if (!page?.page_access_token) {
    throw new AppError(409, 'META_PAGE_TOKEN_MISSING', PAGE_TOKEN_MISSING_MESSAGE, { form_id: String(formId) });
  }
  return { token: page.page_access_token, page, source: 'db_page_token' };
}

async function getUserToken() {
  const stored = await metaTokenRepository.getStoredUserTokenRecord();
  const token = stored?.token || config.meta.userAccessToken || process.env.META_USER_ACCESS_TOKEN || null;
  return token ? {
    token,
    source: stored?.token ? 'db_user_token' : 'env_user_token',
    config: stored?.config || {},
    updated_at: stored?.updated_at || null,
  } : null;
}

async function validateUserTokenPermissions(userToken) {
  const response = await graphGet('me/permissions', {}, userToken, { tokenSource: 'user_token' });
  const granted = new Set((response.data || [])
    .filter(permission => permission.status === 'granted')
    .map(permission => permission.permission));
  const required = [
    'pages_show_list',
    'pages_manage_metadata',
    'leads_retrieval',
    'pages_read_engagement',
    'ads_read',
  ];
  const recommended = ['pages_manage_ads', 'ads_management', 'business_management'];
  const missing = required.filter(permission => !granted.has(permission));
  if (missing.length) {
    throw new AppError(422, 'META_USER_TOKEN_PERMISSIONS_MISSING', `Meta user token is missing required permissions: ${missing.join(', ')}`, { missing_permissions: missing });
  }
  return {
    valid: true,
    permissions: Array.from(granted),
    missing_recommended: recommended.filter(permission => !granted.has(permission)),
  };
}

async function validateAndSavePageToken({ pageId, pageName, token }) {
  let page;
  try {
    page = await graphGet(String(pageId), { fields: 'id,name' }, token, {
      pageId: String(pageId), tokenSource: 'derived_page_token',
    });
  } catch (error) {
    throw new AppError(422, 'META_PAGE_TOKEN_INVALID', PAGE_TOKEN_INVALID_MESSAGE, {
      page_id: String(pageId), meta_code: error.metaCode || null,
    });
  }
  if (String(page.id) !== String(pageId)) {
    throw new AppError(422, 'META_PAGE_TOKEN_INVALID', PAGE_TOKEN_INVALID_MESSAGE, { page_id: String(pageId) });
  }
  return metaTokenRepository.savePageToken({ pageId, pageName: pageName || page.name, token });
}

async function deriveAndSavePageTokenFromUserToken({ userToken, pageId = null }) {
  const response = await graphGet('me/accounts', {
    fields: 'id,name,access_token,tasks,category', limit: 100,
  }, userToken, { tokenSource: 'user_token' });
  const accounts = response.data || [];
  const selected = pageId ? accounts.filter(page => String(page.id) === String(pageId)) : accounts;
  if (pageId && selected.length === 0) {
    throw new AppError(404, 'META_PAGE_NOT_FOUND', 'The supplied user token does not provide access to this Meta page.', { page_id: String(pageId) });
  }
  const saved = [];
  for (const page of selected) {
    if (!page.access_token) continue;
    saved.push(await validateAndSavePageToken({ pageId: page.id, pageName: page.name, token: page.access_token }));
  }
  if (saved.length === 0) {
    throw new AppError(422, 'META_PAGE_TOKEN_MISSING', 'No Page Access Token could be derived from this user token. Confirm page access and required permissions.');
  }
  return saved;
}

async function saveUserToken(token, updatedByUserId = null, metadata = {}) {
  return metaTokenRepository.saveUserToken(token, updatedByUserId, metadata);
}

module.exports = {
  PAGE_TOKEN_MISSING_MESSAGE,
  PAGE_TOKEN_INVALID_MESSAGE,
  maskToken,
  getPageTokenByPageId,
  getRequiredPageToken,
  getPageTokenForForm,
  getUserToken,
  validateUserTokenPermissions,
  validateAndSavePageToken,
  deriveAndSavePageTokenFromUserToken,
  saveUserToken,
  findActivePages: metaTokenRepository.findActivePages,
  updatePageHealth: metaTokenRepository.updatePageHealth,
  updatePageWebhookStatus: metaTokenRepository.updatePageWebhookStatus,
  updatePageFormsStatus: metaTokenRepository.updatePageFormsStatus,
  markPagesStaleExcept: metaTokenRepository.markPagesStaleExcept,
  deactivatePage: metaTokenRepository.deactivatePage,
  updateUserTokenStatus: metaTokenRepository.updateUserTokenStatus,
};
