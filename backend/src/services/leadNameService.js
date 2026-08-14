const { query } = require('../config/database');

const DIRECT_NAME_KEYS = new Set([
  'full_name',
  'fullname',
  'name',
  'lead_name',
  'customer_name',
  'client_name',
  'contact_name',
  'applicant_name',
  'prospect_name',
  'user_name',
  'your_name',
]);

const FIRST_NAME_KEYS = new Set([
  'first_name',
  'firstname',
  'customer_first_name',
  'client_first_name',
  'contact_first_name',
  'applicant_first_name',
  'your_first_name',
]);

const LAST_NAME_KEYS = new Set([
  'last_name',
  'lastname',
  'surname',
  'sir_name',
  'customer_last_name',
  'client_last_name',
  'contact_last_name',
  'applicant_last_name',
  'your_last_name',
]);

const NAME_KEY_EXCLUSIONS = [
  'business',
  'company',
  'brand',
  'campaign',
  'page',
  'form',
  'school',
  'college',
  'institute',
  'project',
  'service',
  'product',
];

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeLeadName(value, max = 190) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.slice(0, max);
}

function chooseBestName(candidates = []) {
  const normalized = [...new Set(candidates.map(value => normalizeLeadName(value)).filter(Boolean))];
  if (!normalized.length) return null;
  normalized.sort((left, right) => right.length - left.length);
  return normalized[0];
}

function isGenericNameKey(key) {
  if (!key || !key.includes('name')) return false;
  if (FIRST_NAME_KEYS.has(key) || LAST_NAME_KEYS.has(key)) return false;
  return !NAME_KEY_EXCLUSIONS.some(token => key.includes(token));
}

function parseNameFromFieldData(fieldData = []) {
  if (!Array.isArray(fieldData)) return null;

  const directCandidates = [];
  let firstName = null;
  let lastName = null;

  for (const row of fieldData) {
    const key = normalizeFieldKey(row?.name);
    const rawValue = Array.isArray(row?.values) ? row.values[0] : row?.values;
    const value = normalizeLeadName(rawValue);
    if (!key || !value) continue;

    if (FIRST_NAME_KEYS.has(key)) {
      firstName = normalizeLeadName([firstName, value].filter(Boolean).join(' '));
      continue;
    }
    if (LAST_NAME_KEYS.has(key)) {
      lastName = normalizeLeadName([lastName, value].filter(Boolean).join(' '));
      continue;
    }
    if (DIRECT_NAME_KEYS.has(key) || isGenericNameKey(key)) {
      directCandidates.push(value);
    }
  }

  const combined = normalizeLeadName([firstName, lastName].filter(Boolean).join(' '));
  return combined || chooseBestName(directCandidates);
}

function parseNameFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const direct = chooseBestName([
    payload.full_name,
    payload.fullName,
    payload.name,
    payload.lead_name,
    payload.leadName,
    payload.customer_name,
    payload.customerName,
    payload.client_name,
    payload.clientName,
    payload.contact_name,
    payload.contactName,
    payload.applicant_name,
    payload.applicantName,
    [payload.first_name, payload.last_name].filter(Boolean).join(' '),
    [payload.firstName, payload.lastName].filter(Boolean).join(' '),
  ]);
  if (direct) return direct;

  return parseNameFromFieldData(payload.field_data || payload.fieldData || []);
}

function deriveNameFromEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return null;
  const localPart = value.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!/[a-z]/i.test(localPart) || localPart.length < 3) return null;
  return normalizeLeadName(localPart.replace(/\b\w/g, char => char.toUpperCase()));
}

function deriveLeadDisplayName({ full_name, email, phone, raw_payload }) {
  return normalizeLeadName(full_name)
    || parseNameFromPayload(raw_payload)
    || deriveNameFromEmail(email)
    || (phone ? `Lead ${String(phone).replace(/\D/g, '').slice(-4)}` : null)
    || null;
}

function applyLeadDisplayName(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  const resolvedName = deriveLeadDisplayName(lead);
  if (resolvedName) lead.full_name = resolvedName;
  delete lead.raw_payload;
  return lead;
}

async function backfillLeadName(leadId, source) {
  const resolvedName = normalizeLeadName(source?.full_name) || parseNameFromPayload(source);
  if (!leadId || !resolvedName) return false;

  const result = await query(
    `UPDATE leads
        SET full_name = $2,
            updated_at = NOW()
      WHERE id = $1
        AND (full_name IS NULL OR BTRIM(full_name) = '')`,
    [leadId, resolvedName],
  );
  return result.rowCount > 0;
}

module.exports = {
  applyLeadDisplayName,
  backfillLeadName,
  deriveLeadDisplayName,
  normalizeFieldKey,
  normalizeLeadName,
  parseNameFromFieldData,
  parseNameFromPayload,
};
