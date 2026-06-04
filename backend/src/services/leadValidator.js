/**
 * Lead validation gate. Runs BEFORE inserting any lead (webhook or
 * recovery/sync path). Rejects:
 *   - Obviously fake phone numbers (1234567890, all-zero, all-same-digit,
 *     too short, too long)
 *   - Test / demo / simulator names + emails
 *
 * Returns { valid: true } if the lead should be inserted, or
 * { valid: false, reason: '<code>' } if it should be silently dropped.
 *
 * The caller is responsible for logging the rejection — see
 * ingestLeadgenEvent / ingestGraphLead.
 */

// Names that look like test data
const TEST_NAME_RE = /\b(test|demo|fake|sample|dummy|simulator|simulated|asdf|qwerty|abc\s*xyz)\b/i;
// Emails that look like test data
const TEST_EMAIL_RE = /(@test\.local|@example\.com|@example\.org|noreply@|test@|demo@|fake@|sample@)/i;
// Common throwaway / placeholder phones
const FAKE_PHONES = new Set([
  '1234567890', '9999999999', '0000000000', '1111111111', '2222222222',
  '3333333333', '4444444444', '5555555555', '6666666666', '7777777777',
  '8888888888', '0987654321', '0123456789', '1234567891',
]);

function digitsOnly(s) {
  return String(s || '').replace(/[^0-9]/g, '');
}

/**
 * Phone is a "real-looking" number if:
 *   - Has 10–15 digits after stripping +, spaces, dashes (10 = standard mobile,
 *     15 = ITU E.164 max). Shorter numbers reject — no valid Meta lead has
 *     fewer than 10 digits in the captured phone.
 *   - Not in the known-fake list
 *   - Not all the same digit (e.g. 9999999999) on either the full string or
 *     the last 10 digits (so +918888888888 with country code is still caught)
 *   - Not a strict ascending/descending sequence (1234567890, 9876543210)
 */
function isValidPhone(phone) {
  const d = digitsOnly(phone);
  if (d.length < 10 || d.length > 15) return false;
  if (FAKE_PHONES.has(d)) return false;
  // all same digit (full string)?
  if (/^(\d)\1+$/.test(d)) return false;
  // all same digit in the trailing 10 digits (catches +91 + 88888 88888)?
  const tail10 = d.slice(-10);
  if (/^(\d)\1+$/.test(tail10)) return false;
  if (FAKE_PHONES.has(tail10)) return false;
  // strict ascending 1234567890 or 0123456789
  if ('01234567890123456789'.includes(d) || '01234567890123456789'.includes(tail10)) return false;
  // strict descending 9876543210 or 0987654321
  if ('98765432109876543210'.includes(d) || '98765432109876543210'.includes(tail10)) return false;
  return true;
}

/**
 * Returns { valid, reason } for a parsed lead's field data.
 * fields = { full_name, phone, email, ... } as produced by parseFieldData().
 *
 * Behavior — opinionated:
 *   - Missing BOTH phone AND email → reject (no way to follow up)
 *   - Test/demo/fake name OR email → reject
 *   - Phone present but obviously fake → reject (we'd rather lose 1 real
 *     lead with a typo'd phone than admit 50 fake ones)
 *   - Email-only with no phone is OK if email looks real
 */
function validateLead(fields) {
  const { full_name, phone, email } = fields || {};

  if (!phone && !email) {
    return { valid: false, reason: 'no_contact' };
  }

  if (full_name && TEST_NAME_RE.test(full_name)) {
    return { valid: false, reason: 'test_name_pattern' };
  }

  if (email && TEST_EMAIL_RE.test(email)) {
    return { valid: false, reason: 'test_email_pattern' };
  }

  if (phone && !isValidPhone(phone)) {
    return { valid: false, reason: 'invalid_phone' };
  }

  return { valid: true };
}

module.exports = { validateLead, isValidPhone };
