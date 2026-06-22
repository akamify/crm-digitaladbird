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

function resolveConfiguredSheetNames(config) {
  const cfg = config || {};
  const defaultSheetName = cleanedName(cfg.default_sheet_name || cfg.sheet_name || 'Leads');
  if (!defaultSheetName) {
    throw new Error('Default Google Sheet tab name is missing.');
  }

  return {
    defaultSheetName,
    traderSheetName: cleanedName(cfg.trader_sheet_name || 'Traders') || defaultSheetName,
    partnerSheetName: cleanedName(cfg.partner_sheet_name || 'Partners') || defaultSheetName,
    unknownSheetName: cleanedName(cfg.unknown_sheet_name || 'Unknown Leads') || defaultSheetName,
  };
}

function resolveLeadSheetName({ lead, config }) {
  const cfg = config || {};
  const category = normalizeCategory(lead?.lead_type || lead?.category || lead?.type || lead?.lead_category);
  const {
    defaultSheetName,
    traderSheetName,
    partnerSheetName,
    unknownSheetName,
  } = resolveConfiguredSheetNames(cfg);
  const routingEnabled = cfg.category_sheet_routing_enabled !== false;

  if (!routingEnabled) {
    return { sheetName: defaultSheetName, category, source: 'default_sheet' };
  }

  if (category === 'trader') {
    return {
      sheetName: traderSheetName,
      category,
      source: traderSheetName === defaultSheetName ? 'default_sheet' : 'category_routing',
    };
  }

  if (category === 'partner') {
    return {
      sheetName: partnerSheetName,
      category,
      source: partnerSheetName === defaultSheetName ? 'default_sheet' : 'category_routing',
    };
  }

  return {
    sheetName: unknownSheetName,
    category,
    source: unknownSheetName === defaultSheetName ? 'default_sheet' : 'category_routing',
  };
}

function resolveLeadSheetTargets({ lead, config }) {
  const cfg = config || {};
  const category = normalizeCategory(lead?.lead_type || lead?.category || lead?.type || lead?.lead_category);
  const {
    defaultSheetName,
    traderSheetName,
    partnerSheetName,
    unknownSheetName,
  } = resolveConfiguredSheetNames(cfg);
  const routingEnabled = cfg.category_sheet_routing_enabled !== false;
  const targets = [{ key: 'master', sheetName: defaultSheetName, category, source: 'master_sheet' }];

  if (routingEnabled) {
    if (category === 'trader') {
      targets.push({ key: 'trader', sheetName: traderSheetName, category, source: 'category_routing' });
    } else if (category === 'partner') {
      targets.push({ key: 'partner', sheetName: partnerSheetName, category, source: 'category_routing' });
    } else if (unknownSheetName) {
      targets.push({ key: 'unknown', sheetName: unknownSheetName, category, source: 'category_routing' });
    }
  }

  const seen = new Set();
  return targets.filter((target) => {
    const key = target.sheetName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  normalizeCategory,
  sanitizeSheetName,
  resolveLeadSheetName,
  resolveLeadSheetTargets,
  resolveConfiguredSheetNames,
};
