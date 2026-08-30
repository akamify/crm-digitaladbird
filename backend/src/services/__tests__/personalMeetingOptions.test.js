jest.mock('../../config/database', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ getVisibleUserIds: jest.fn(() => []) }));
jest.mock('../../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock('../customerMeetingNotificationService', () => ({ sendMeetingNotification: jest.fn() }));
jest.mock('../../utils/auditLog', () => ({ logActivity: jest.fn() }));

const {
  PERSONAL_MEETING_DEFAULT_PACKAGE_SERVICE_KEYS,
  PERSONAL_MEETING_DEFAULT_SERVICES,
  isCustomerNoteKind,
  isPersonalMeetingMode,
  isPersonalMeetingOutcome,
  isPersonalMeetingPricingType,
} = require('../../constants/personalMeetingOptions');
const { __private } = require('../customerNoteService');

describe('personal meeting option policy', () => {
  test('accepts only the additive personal-meeting note kind', () => {
    expect(isCustomerNoteKind('personal_meeting')).toBe(true);
    expect(isCustomerNoteKind('general')).toBe(true);
    expect(isCustomerNoteKind('unknown_kind')).toBe(false);
  });

  test('keeps Zoom and the supported meeting modes centralized', () => {
    expect(isPersonalMeetingMode('zoom')).toBe(true);
    expect(isPersonalMeetingMode('google_meet')).toBe(true);
    expect(isPersonalMeetingMode('carrier_pigeon')).toBe(false);
  });

  test('keeps package defaults inside the supported service catalog', () => {
    const catalogKeys = new Set(PERSONAL_MEETING_DEFAULT_SERVICES.map((service) => service.key));
    expect(PERSONAL_MEETING_DEFAULT_PACKAGE_SERVICE_KEYS.every((key) => catalogKeys.has(key))).toBe(true);
  });

  test('accepts valid pricing types and meeting outcomes only', () => {
    expect(isPersonalMeetingPricingType('individual_services')).toBe(true);
    expect(isPersonalMeetingPricingType('package')).toBe(true);
    expect(isPersonalMeetingPricingType('bundle')).toBe(false);
    expect(isPersonalMeetingOutcome('proposal_required')).toBe(true);
    expect(isPersonalMeetingOutcome('promised_sale')).toBe(false);
  });

  test('keeps individual prices only on selected individual services', () => {
    const services = __private.normalizePersonalMeetingServices([
      { service_key: 'meta_ads', quoted_price: 15000, pricing_note: 'Monthly management', client_interested: true },
      { service_key: 'custom_sales_funnel', service_name: 'Sales Funnel', is_custom: true, quoted_price: 24000 },
    ], 'individual_services');
    expect(services).toEqual(expect.arrayContaining([
      expect.objectContaining({ service_key: 'meta_ads', quoted_price: 15000, client_interested: true }),
      expect.objectContaining({ service_key: 'custom_sales_funnel', is_custom: true, quoted_price: 24000 }),
    ]));
  });

  test('removes hidden individual prices when the payload is package mode', () => {
    const services = __private.normalizePersonalMeetingServices([
      { service_key: 'website_development', quoted_price: 25000, pricing_note: 'Old individual value' },
    ], 'package');
    expect(services[0]).toEqual(expect.objectContaining({ is_package_item: true, quoted_price: null, pricing_note: null }));
  });
});
