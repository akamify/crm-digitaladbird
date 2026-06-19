const axios = require('axios');
const config = require('../config/env');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const metaTokenRepository = require('../repositories/metaTokenRepository');

const GRAPH_BASE = `https://graph.facebook.com/${config.meta.graphVersion}`;

function normalizePath(path) {
  if (!String(path).startsWith('http')) return String(path).replace(/^\//, '');
  const url = new URL(path);
  url.searchParams.delete('access_token');
  return `${url.pathname.replace(/^\//, '')}${url.search}`;
}

function safeMetaError(err, context) {
  const upstream = err.response?.data?.error;
  const error = new Error(upstream?.message || err.message || 'Meta Graph API request failed');
  error.code = upstream?.code || 'META_GRAPH_ERROR';
  error.metaCode = upstream?.code || null;
  error.metaType = upstream?.type || null;
  error.metaSubcode = upstream?.error_subcode || null;
  error.context = context;
  error.isOAuthError = upstream?.type === 'OAuthException' || upstream?.code === 190;
  return error;
}

async function request(method, path, payload, token, context = {}) {
  if (!token) throw new Error('Meta Graph token must be passed explicitly');
  const normalized = normalizePath(path);
  const [pathname, queryString] = normalized.split('?');
  const queryParams = Object.fromEntries(new URLSearchParams(queryString || ''));
  const safeContext = {
    endpoint: pathname,
    page_id: context.pageId || null,
    form_id: context.formId || null,
    token_source: context.tokenSource || 'explicit',
  };
  try {
    const response = await axios({
      method,
      url: `${GRAPH_BASE}/${pathname}`,
      params: { ...queryParams, ...(method === 'get' ? payload : {}), access_token: token },
      data: method === 'post' ? new URLSearchParams(payload).toString() : undefined,
      headers: method === 'post' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      timeout: context.timeout || 30000,
    });
    return response.data;
  } catch (rawError) {
    const error = safeMetaError(rawError, safeContext);
    logger.warn({ ...safeContext, meta_code: error.metaCode, error: error.message }, 'Meta Graph request failed');
    if (error.isOAuthError && context.pageId && context.tokenSource === 'db_page_token') {
      await metaTokenRepository.updatePageHealth(context.pageId, { valid: false, error: error.message }).catch(() => {});
      throw new AppError(422, 'META_PAGE_TOKEN_INVALID', 'Page access token is invalid. Update Meta token and reconnect this page.', {
        page_id: String(context.pageId), meta_code: error.metaCode,
      });
    }
    throw error;
  }
}

function graphGet(path, params, token, context) {
  return request('get', path, params || {}, token, context);
}

function graphPost(path, body, token, context) {
  return request('post', path, body || {}, token, context);
}

function graphDebugToken(inputToken, appTokenOrUserToken) {
  return graphGet('debug_token', { input_token: inputToken }, appTokenOrUserToken, { tokenSource: 'app_or_user_token' });
}

module.exports = { graphGet, graphPost, graphDebugToken };
