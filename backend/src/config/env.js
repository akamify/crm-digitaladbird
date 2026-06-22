/**
 * Centralized environment configuration.
 * Fails fast at boot if required vars are missing.
 */
const dotenv = require('dotenv');
dotenv.config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined || val === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[config] Missing required env var: ${name}`);
    }
    console.warn(`[config] WARN missing env ${name} (using fallback in dev)`);
  }
  return val;
}

const config = {
  env:       process.env.NODE_ENV || 'development',
  port:      parseInt(process.env.PORT || '4000', 10),
  appUrl:    process.env.APP_URL || 'http://localhost:3000',

  db: {
    url:                 required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/digitaladbird'),
    ssl:                 process.env.DB_SSL === 'true',
    poolMax:             parseInt(process.env.DB_POOL_MAX || '20', 10),
    statementTimeoutMs:  parseInt(process.env.DB_STATEMENT_TIMEOUT || '15000', 10),
  },

  jwt: {
    accessSecret:    required('JWT_ACCESS_SECRET',  'dev_access_secret_change_me'),
    refreshSecret:   required('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'),
    accessTtl:       process.env.JWT_ACCESS_TTL  || '15m',
    sessionTtlHours: parseInt(process.env.JWT_SESSION_TTL_HOURS || '24', 10),
    refreshTtlDays:  parseInt(process.env.JWT_REFRESH_TTL_DAYS || '30', 10),
  },

  otp: {
    provider:    process.env.OTP_PROVIDER     || 'console', // 'msg91' | 'twilio' | 'fast2sms' | 'console'
    length:      parseInt(process.env.OTP_LENGTH || '6', 10),
    ttlSeconds:  parseInt(process.env.OTP_TTL_SECONDS || '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),

    // MSG91 (most popular in India for transactional OTPs)
    msg91: {
      authKey:    process.env.MSG91_AUTH_KEY,
      templateId: process.env.MSG91_TEMPLATE_ID,
      senderId:   process.env.MSG91_SENDER_ID || 'OTPSMS',
    },
    // Twilio fallback
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken:  process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER,
    },
    // Fast2SMS
    fast2sms: {
      apiKey: process.env.FAST2SMS_API_KEY,
    },
  },

  meta: {
    appId:            process.env.META_APP_ID,
    appSecret:        process.env.META_APP_SECRET,
    userAccessToken:  process.env.META_USER_ACCESS_TOKEN,
    pageAccessToken:  process.env.META_PAGE_ACCESS_TOKEN,
    pageId:           process.env.META_PAGE_ID,
    pageName:         process.env.META_PAGE_NAME,
    adAccountIds:     (process.env.META_AD_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    formId:           process.env.META_FORM_ID,
    verifyToken:      process.env.META_VERIFY_TOKEN || 'change_this_verify_token',
    graphVersion:     process.env.META_GRAPH_VERSION || 'v21.0',
  },

  leadLock: {
    durationMinutes: parseInt(process.env.LEAD_LOCK_MINUTES || '10', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX       || '120',   10),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
  },

  email: {
    provider:          process.env.EMAIL_PROVIDER || 'brevo',
    brevoApiKey:       process.env.BREVO_API_KEY || '',
    senderEmail:       process.env.BREVO_SENDER_EMAIL || '',
    senderName:        process.env.BREVO_SENDER_NAME || 'DigitalADbird CRM',
    frontendUrl:       (process.env.APP_FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    resetTtlMinutes:   parseInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || '30', 10),
    resetMaxPerHour:   parseInt(process.env.PASSWORD_RESET_MAX_PER_HOUR || '5', 10),
    resetTemplateId:   process.env.BREVO_RESET_TEMPLATE_ID || '',
    onboardingTemplateId: process.env.BREVO_ONBOARDING_TEMPLATE_ID || '',
    adminResetTemplateId: process.env.BREVO_ADMIN_RESET_TEMPLATE_ID || '',
  },

  wasp: {
    enabled: String(process.env.WASP_CHAT_ENABLED || 'false').toLowerCase() === 'true',
    baseUrl: (process.env.WASP_BASE_URL || 'https://wasp.akamify.com').replace(/\/+$/, ''),
    apiKey: process.env.WASP_API_KEY || '',
    apiKeyHeader: process.env.WASP_API_KEY_HEADER || 'X-API-Key',
    sendMessagePath: process.env.WASP_SEND_MESSAGE_PATH || '/api/chat/messages/send',
    fetchMessagesPath: process.env.WASP_FETCH_MESSAGES_PATH || '/api/chat/messages',
    webhookSecret: process.env.WASP_WEBHOOK_SECRET || '',
    webhookPath: process.env.WASP_WEBHOOK_PATH || '/api/integrations/wasp/webhook',
    defaultCountryCode: process.env.WASP_DEFAULT_COUNTRY_CODE || '91',
    chatSessionHours: parseInt(process.env.WASP_CHAT_SESSION_HOURS || '24', 10),
    unknownContactsAdminOnly: String(process.env.WASP_UNKNOWN_CONTACTS_ADMIN_ONLY || 'true').toLowerCase() !== 'false',
    createLeadFromUnknownInbound: String(process.env.WASP_CREATE_LEAD_FROM_UNKNOWN_INBOUND || 'false').toLowerCase() === 'true',
    inboundEmailNotifyAssignee: String(process.env.WASP_INBOUND_EMAIL_NOTIFY_ASSIGNEE || 'true').toLowerCase() !== 'false',
    newMessageSoundEnabled: String(process.env.WASP_NEW_MESSAGE_SOUND_ENABLED || 'true').toLowerCase() !== 'false',
  },
};

module.exports = config;
