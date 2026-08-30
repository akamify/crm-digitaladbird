const { asyncHandler } = require('../utils/errors');
const report = require('../services/counselorReportService');

exports.summary = asyncHandler(async (req, res) => res.json({ success: true, data: await report.summary(req.query) }));
exports.counselors = asyncHandler(async (req, res) => res.json({ success: true, data: await report.getCounselorRows(req.query) }));
exports.teams = asyncHandler(async (req, res) => res.json({ success: true, data: await report.teams(req.query) }));
exports.filters = asyncHandler(async (_req, res) => res.json({ success: true, data: await report.filters() }));
exports.leads = asyncHandler(async (req, res) => res.json({ success: true, data: await report.drilldown(req.query) }));
