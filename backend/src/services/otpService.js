/**
 * OTP service. Supports multiple SMS providers; selects by env OTP_PROVIDER.
 *  - msg91     : recommended for India
 *  - twilio    : international fallback
 *  - fast2sms  : alternative India option
 *  - console   : dev only, prints OTP to logs
 *
 * Codes are stored hashed (bcrypt) so DB leak cannot reveal active OTPs.
 * Rate-limiting and attempt caps live in the service, not the controller.
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios  = require('axios');
const config = require('../config/env');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

function generateNumericCode(len) {
  let out = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += (buf[i] % 10).toString();
  return out;
}

async function sendViaMsg91(phone, code) {
  const { authKey, templateId } = config.otp.msg91;
  if (!authKey || !templateId) throw new AppError(500, 'OTP_PROVIDER_MISCONFIGURED', 'MSG91 keys missing');
  // MSG91 Flow API
  await axios.post('https://control.msg91.com/api/v5/flow/', {
    template_id: templateId,
    sender:      config.otp.msg91.senderId,
    short_url:   '0',
    mobiles:     phone.replace(/^\+/, ''),
    otp:         code,
  }, { headers: { authkey: authKey, 'Content-Type': 'application/json' }, timeout: 10000 });
}

async function sendViaTwilio(phone, code) {
  const { accountSid, authToken, fromNumber } = config.otp.twilio;
  if (!accountSid || !authToken || !fromNumber) {
    throw new AppError(500, 'OTP_PROVIDER_MISCONFIGURED', 'Twilio creds missing');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: phone,
    From: fromNumber,
    Body: `Your DigitalADbird CRM OTP is ${code}. Valid for ${Math.floor(config.otp.ttlSeconds / 60)} minutes.`,
  });
  await axios.post(url, params, {
    auth: { username: accountSid, password: authToken },
    timeout: 10000,
  });
}

async function sendViaFast2Sms(phone, code) {
  const { apiKey } = config.otp.fast2sms;
  if (!apiKey) throw new AppError(500, 'OTP_PROVIDER_MISCONFIGURED', 'Fast2SMS key missing');
  await axios.post('https://www.fast2sms.com/dev/bulkV2', {
    route:        'otp',
    variables_values: code,
    numbers:      phone.replace(/^\+91/, ''),
  }, { headers: { authorization: apiKey, 'Content-Type': 'application/json' }, timeout: 10000 });
}

async function deliver(phone, code) {
  if (config.otp.provider === 'console' || config.env === 'test') {
    logger.warn({ phone, code }, '[OTP] (console provider) – send a real OTP in production!');
    return;
  }
  if (config.otp.provider === 'msg91')    return sendViaMsg91(phone, code);
  if (config.otp.provider === 'twilio')   return sendViaTwilio(phone, code);
  if (config.otp.provider === 'fast2sms') return sendViaFast2Sms(phone, code);
  throw new AppError(500, 'OTP_PROVIDER_UNKNOWN', `Unknown OTP provider: ${config.otp.provider}`);
}

/**
 * Issue an OTP for a phone identifier. Rate-limits to 1 active OTP per minute
 * (to prevent SMS bombing). Returns nothing — code is delivered out-of-band.
 */
async function issueOtp(identifier, ip) {
  // anti-bombing: don't issue if an unexpired, unused OTP < 60s old exists
  const { rows } = await query(
    `SELECT id, created_at FROM otp_codes
      WHERE identifier = $1 AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [identifier]
  );
  if (rows[0] && Date.now() - new Date(rows[0].created_at).getTime() < 60_000) {
    throw new AppError(429, 'OTP_RATE_LIMITED', 'Please wait a moment before requesting another OTP');
  }

  const code     = generateNumericCode(config.otp.length);
  const codeHash = await bcrypt.hash(code, 10);
  const expires  = new Date(Date.now() + config.otp.ttlSeconds * 1000);

  await query(
    `INSERT INTO otp_codes(identifier, channel, code_hash, expires_at, ip_address)
       VALUES ($1, 'sms', $2, $3, $4)`,
    [identifier, codeHash, expires, ip || null]
  );

  await deliver(identifier, code);
  return { expiresInSeconds: config.otp.ttlSeconds };
}

/**
 * Verify a submitted OTP. Returns true on success.
 * Increments attempts; locks after maxAttempts.
 */
async function verifyOtp(identifier, code) {
  const { rows } = await query(
    `SELECT id, code_hash, attempts, expires_at
       FROM otp_codes
      WHERE identifier = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [identifier]
  );
  const otp = rows[0];
  if (!otp)                                   throw new AppError(400, 'OTP_NOT_FOUND', 'No OTP request found');
  if (new Date(otp.expires_at) < new Date())  throw new AppError(400, 'OTP_EXPIRED',   'OTP has expired');
  if (otp.attempts >= config.otp.maxAttempts) throw new AppError(429, 'OTP_LOCKED',    'Too many attempts, request a new OTP');

  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    throw new AppError(400, 'OTP_INVALID', 'Incorrect OTP');
  }

  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
  return true;
}

module.exports = { issueOtp, verifyOtp };
