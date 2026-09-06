const service = require('../services/leadSavedViewService');
const { asyncHandler } = require('../utils/errors');

exports.list = asyncHandler(async (req, res) => {
  const views = await service.listViews(req.user);
  res.json({ success: true, data: views });
});

exports.create = asyncHandler(async (req, res) => {
  const view = await service.createView(req.user, req.body || {});
  res.status(201).json({ success: true, data: view });
});

exports.update = asyncHandler(async (req, res) => {
  const view = await service.updateView(req.user, req.params.viewId, req.body || {});
  res.json({ success: true, data: view });
});

exports.remove = asyncHandler(async (req, res) => {
  const view = await service.deleteView(req.user, req.params.viewId);
  res.json({ success: true, data: view });
});
