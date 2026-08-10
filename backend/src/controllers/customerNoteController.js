const { asyncHandler } = require('../utils/errors');
const customerNotes = require('../services/customerNoteService');

exports.list = asyncHandler(async (req, res) => {
  const data = await customerNotes.listNotes(req.user, req.query);
  res.json({ success: true, data });
});

exports.create = asyncHandler(async (req, res) => {
  const data = await customerNotes.createNote(req.user, req.body);
  res.status(201).json({ success: true, data, message: 'Note created successfully.' });
});

exports.detail = asyncHandler(async (req, res) => {
  const data = await customerNotes.getNoteDetail(req.user, req.params.noteId, { includePendingForAdmin: true });
  res.json({ success: true, data });
});

exports.update = asyncHandler(async (req, res) => {
  const data = await customerNotes.updateNote(req.user, req.params.noteId, req.body);
  res.json({ success: true, data, message: 'Note updated successfully.' });
});

exports.remove = asyncHandler(async (req, res) => {
  const data = await customerNotes.deleteNote(req.user, req.params.noteId);
  res.json({ success: true, data, message: 'Note deleted successfully.' });
});

exports.addEntry = asyncHandler(async (req, res) => {
  const data = await customerNotes.addEntry(req.user, req.params.noteId, req.body);
  res.status(201).json({ success: true, data, message: 'Note entry added successfully.' });
});

exports.updateEntry = asyncHandler(async (req, res) => {
  const data = await customerNotes.updateEntry(req.user, req.params.noteId, req.params.entryId, req.body);
  res.json({ success: true, data, message: 'Note entry updated successfully.' });
});

exports.removeEntry = asyncHandler(async (req, res) => {
  const data = await customerNotes.deleteEntry(req.user, req.params.noteId, req.params.entryId);
  res.json({ success: true, data, message: 'Note entry deleted successfully.' });
});

exports.approve = asyncHandler(async (req, res) => {
  const data = await customerNotes.approveNote(req.user, req.params.noteId);
  res.json({ success: true, data, message: 'Note approved successfully.' });
});

exports.reject = asyncHandler(async (req, res) => {
  const data = await customerNotes.rejectNote(req.user, req.params.noteId, req.body?.rejection_note || req.body?.reason || req.body?.note);
  res.json({ success: true, data, message: 'Note rejected successfully.' });
});

exports.lookupLeads = asyncHandler(async (req, res) => {
  const data = await customerNotes.lookupLeads(req.user, req.query);
  res.json({ success: true, data });
});

exports.lookupUsers = asyncHandler(async (req, res) => {
  const data = await customerNotes.lookupUsers(req.user, req.query);
  res.json({ success: true, data });
});

exports.upcomingMeetings = asyncHandler(async (req, res) => {
  const data = await customerNotes.listUpcomingMeetings(req.user, req.query);
  res.json({ success: true, data });
});
