const crypto = require('crypto');
const { google } = require('googleapis');
const { query } = require('../config/database');

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

function scopes() {
  return String(process.env.GOOGLE_USER_SHEET_SCOPES || DEFAULT_SCOPES.join(' '))
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function isConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID
    && process.env.GOOGLE_OAUTH_CLIENT_SECRET
    && process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

function requireConfigured() {
  if (!isConfigured()) {
    const err = new Error('Google OAuth is not configured on the server.');
    err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
    throw err;
  }
}

function oauthClient() {
  requireConfigured();
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const secret = process.env.GOOGLE_USER_SHEET_TOKEN_ENCRYPTION_KEY
    || process.env.JWT_ACCESS_SECRET
    || process.env.JWT_SECRET;
  if (!secret) throw new Error('GOOGLE_USER_SHEET_TOKEN_ENCRYPTION_KEY or JWT_ACCESS_SECRET is required for OAuth state.');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function tokenKey() {
  const seed = process.env.GOOGLE_USER_SHEET_TOKEN_ENCRYPTION_KEY
    || process.env.JWT_ACCESS_SECRET
    || process.env.JWT_SECRET;
  if (!seed) throw new Error('GOOGLE_USER_SHEET_TOKEN_ENCRYPTION_KEY is required to encrypt Google OAuth tokens.');
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptToken(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptToken(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function createState({ userId }) {
  const body = JSON.stringify({
    user_id: userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
  });
  const payload = base64url(body);
  return `${payload}.${sign(payload)}`;
}

function verifyState(state) {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature || sign(payload) !== signature) {
    const err = new Error('Invalid Google OAuth state.');
    err.code = 'GOOGLE_OAUTH_STATE_INVALID';
    throw err;
  }
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!parsed.user_id || Date.now() > Number(parsed.exp || 0)) {
    const err = new Error('Google OAuth state expired.');
    err.code = 'GOOGLE_OAUTH_STATE_INVALID';
    throw err;
  }
  return parsed;
}

async function generateAuthUrl({ userId, forceConsent = true }) {
  const client = oauthClient();
  const state = createState({ userId });
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: forceConsent ? 'consent' : undefined,
    scope: scopes(),
    state,
    include_granted_scopes: true,
  });
}

function safeExpiry(tokens) {
  if (!tokens.expiry_date) return null;
  return new Date(tokens.expiry_date).toISOString();
}

async function saveTokens({ userId, tokens }) {
  const accessToken = tokens.access_token || null;
  const refreshToken = tokens.refresh_token || null;
  const tokenScopes = tokens.scope ? String(tokens.scope).split(/\s+/).filter(Boolean) : scopes();
  const expiry = safeExpiry(tokens);

  const existing = await getActiveConnection(userId);
  if (!refreshToken && !existing?.refresh_token_encrypted) {
    const err = new Error('Google did not return a refresh token. Please reconnect and approve offline access.');
    err.code = 'GOOGLE_SHEETS_REFRESH_FAILED';
    throw err;
  }

  const googleEmail = await resolveGoogleEmail(tokens).catch(() => null);
  const result = await query(
    `INSERT INTO user_google_sheet_connections (
       user_id, google_email, access_token_encrypted, refresh_token_encrypted, token_expiry, scopes,
       default_sheet_name, trader_sheet_name, partner_sheet_name, unknown_sheet_name,
       disconnected_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'Leads', 'Traders', 'Partners', 'Unknown Leads', NULL, NOW())
     ON CONFLICT (user_id) WHERE disconnected_at IS NULL DO UPDATE SET
       google_email = COALESCE(EXCLUDED.google_email, user_google_sheet_connections.google_email),
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, user_google_sheet_connections.refresh_token_encrypted),
       token_expiry = EXCLUDED.token_expiry,
       scopes = EXCLUDED.scopes,
       last_error = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      googleEmail,
      encryptToken(accessToken),
      refreshToken ? encryptToken(refreshToken) : null,
      expiry,
      tokenScopes,
    ],
  );
  return result.rows[0];
}

async function resolveGoogleEmail(tokens) {
  if (tokens.id_token) {
    const parts = String(tokens.id_token).split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.email) return payload.email;
    }
  }
  if (!tokens.access_token) return null;
  const client = oauthClient();
  client.setCredentials({ access_token: tokens.access_token });
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const profile = await oauth2.userinfo.get();
  return profile.data?.email || null;
}

async function exchangeCallback({ code, state }) {
  const verified = verifyState(state);
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  await saveTokens({ userId: verified.user_id, tokens });
  return { user_id: verified.user_id };
}

async function getActiveConnection(userId) {
  const { rows: [connection] } = await query(
    `SELECT * FROM user_google_sheet_connections
      WHERE user_id = $1 AND disconnected_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
  return connection || null;
}

async function authorizedClientForConnection(connection) {
  if (!connection?.refresh_token_encrypted && !connection?.access_token_encrypted) {
    const err = new Error('Google Sheets is not connected.');
    err.code = 'GOOGLE_SHEETS_NOT_CONNECTED';
    throw err;
  }
  const client = oauthClient();
  const tokens = {
    access_token: decryptToken(connection.access_token_encrypted),
    refresh_token: decryptToken(connection.refresh_token_encrypted),
    expiry_date: connection.token_expiry ? new Date(connection.token_expiry).getTime() : undefined,
  };
  client.setCredentials(tokens);

  const expiresSoon = !tokens.expiry_date || tokens.expiry_date < Date.now() + 60_000;
  if (expiresSoon && tokens.refresh_token) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const nextAccessToken = credentials.access_token || tokens.access_token;
      const nextExpiry = credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : connection.token_expiry;
      await query(
        `UPDATE user_google_sheet_connections
            SET access_token_encrypted = $2,
                token_expiry = $3,
                last_error = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [connection.id, encryptToken(nextAccessToken), nextExpiry],
      );
      client.setCredentials({
        access_token: nextAccessToken,
        refresh_token: tokens.refresh_token,
        expiry_date: credentials.expiry_date || tokens.expiry_date,
      });
    } catch (error) {
      await query(
        `UPDATE user_google_sheet_connections SET last_error = $2, updated_at = NOW() WHERE id = $1`,
        [connection.id, 'Google token refresh failed. Please reconnect.'],
      ).catch(() => {});
      const err = new Error('Google token refresh failed. Please reconnect.');
      err.code = 'GOOGLE_SHEETS_REFRESH_FAILED';
      throw err;
    }
  }

  return client;
}

async function disconnect(userId) {
  const connection = await getActiveConnection(userId);
  if (!connection) return { disconnected: false };
  try {
    const client = await authorizedClientForConnection(connection);
    const accessToken = decryptToken(connection.access_token_encrypted);
    if (accessToken) await client.revokeToken(accessToken).catch(() => {});
  } catch (_) {
    // Best effort; disconnect must still clear local access.
  }
  await query(
    `UPDATE user_google_sheet_connections
        SET disconnected_at = NOW(),
            access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            sync_enabled = FALSE,
            updated_at = NOW()
      WHERE id = $1`,
    [connection.id],
  );
  return { disconnected: true };
}

module.exports = {
  scopes,
  isConfigured,
  generateAuthUrl,
  exchangeCallback,
  getActiveConnection,
  authorizedClientForConnection,
  disconnect,
};
