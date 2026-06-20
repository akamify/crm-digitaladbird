function normalizeCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'trader') return 'trader';
  if (raw === 'partner') return 'partner';
  return 'unknown';
}

function sanitizeSheetName(value) {
  const text = String(value || '')
    .replace(/[\[\]\*\?\/\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 100);
}

function cleanedName(value) {
  const name = sanitizeSheetName(value);
  return name || null;
}

function resolveLeadSheetName({ lead, config }) {
  const cfg = config || {};
  const category = normalizeCategory(lead?.category);
  const defaultSheetName = cleanedName(cfg.default_sheet_name || cfg.sheet_name || 'Leads');
  const routingEnabled = cfg.category_sheet_routing_enabled !== false;

  if (!defaultSheetName) {
    throw new Error('Default Google Sheet tab name is missing.');
  }

  if (!routingEnabled) {
    return { sheetName: defaultSheetName, category, source: 'default_sheet' };
  }

  if (category === 'trader') {
    return {
      sheetName: cleanedName(cfg.trader_sheet_name) || defaultSheetName,
      category,
      source: cleanedName(cfg.trader_sheet_name) ? 'category_routing' : 'default_sheet',
    };
  }

  if (category === 'partner') {
    return {
      sheetName: cleanedName(cfg.partner_sheet_name) || defaultSheetName,
      category,
      source: cleanedName(cfg.partner_sheet_name) ? 'category_routing' : 'default_sheet',
    };
  }

  return {
    sheetName: cleanedName(cfg.unknown_sheet_name) || defaultSheetName,
    category,
    source: cleanedName(cfg.unknown_sheet_name) ? 'category_routing' : 'default_sheet',
  };
}

module.exports = {
  normalizeCategory,
  sanitizeSheetName,
  resolveLeadSheetName,
};
