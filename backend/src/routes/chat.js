const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { query, withTransaction } = require('../config/database');
const { AppError, asyncHandler } = require('../utils/errors');
const { emitToUser, emitToConversation } = require('../services/socketService');
const { assertLeadCommunicationAccess } = require('../services/leadCommunicationAccess');
const { getOrCreateLeadConversation } = require('../services/leadConversationService');
const logger = require('../utils/logger');

const DIRECT_CHAT_DISABLED_CODE = 'DIRECT_CHAT_DISABLED_FOR_ROLE';
const DIRECT_CHAT_DISABLED_MESSAGE = 'Members and partners can chat only with their assigned leads.';

function isLeadOnlyChatRole(user) {
  return user?.role === 'member' || user?.role === 'partner';
}

function directChatDisabledError() {
  return new AppError(403, DIRECT_CHAT_DISABLED_CODE, DIRECT_CHAT_DISABLED_MESSAGE);
}

// ─── File upload config ────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|csv|txt|mp4|mp3|ogg|webm|wav|zip|rar|7z/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mime = allowed.test(file.mimetype) || allowed.test(ext);
    cb(mime ? null : new Error('File type not allowed'), mime);
  },
});

router.use(authenticate);

// Throttled last_seen update (once per minute per user)
const lastSeenCache = new Map();
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [k, v] of lastSeenCache) {
    if (v < cutoff) lastSeenCache.delete(k);
  }
}, 300_000);
router.use(asyncHandler(async (req, _res, next) => {
  const now = Date.now();
  const last = lastSeenCache.get(req.user.id) || 0;
  if (now - last > 60_000) {
    lastSeenCache.set(req.user.id, now);
    query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [req.user.id]).catch(() => {});
  }
  next();
}));

// ─── Permission helpers ────────────────────────────────────────────
async function assertParticipant(userId, conversationId) {
  const { rows } = await query(
    `SELECT is_blocked FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (!rows.length) throw new AppError(403, 'NOT_PARTICIPANT', 'You are not in this conversation');
  if (rows[0].is_blocked) throw new AppError(403, 'BLOCKED', 'You are blocked from this conversation');
}

async function assertConversationAccess(user, conversationId) {
  const { rows: [conversation] } = await query(
    `SELECT id, type, lead_id FROM chat_conversations WHERE id = $1 AND is_deleted = FALSE`,
    [conversationId],
  );
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  if (conversation.type === 'lead' && conversation.lead_id) {
    await assertLeadCommunicationAccess(user, conversation.lead_id);
    await query(
      `INSERT INTO chat_participants (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, user.id],
    );
    return conversation;
  }
  if (isLeadOnlyChatRole(user)) throw directChatDisabledError();
  await assertParticipant(user.id, conversationId);
  return conversation;
}

async function canMessage(sender, targetUserId) {
  if (isLeadOnlyChatRole(sender)) return false;
  if (sender.role === 'super_admin') return true;
  const { rows } = await query(
    `SELECT id, role, report_to_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [targetUserId]
  );
  if (!rows.length) throw new AppError(404, 'USER_NOT_FOUND', 'Target user not found');
  const target = rows[0];
  if (sender.role === 'rm') {
    return target.role === 'super_admin' || target.report_to_id === sender.id;
  }
  if (sender.role === 'member' || sender.role === 'partner') {
    return target.role === 'super_admin' || target.id === sender.report_to_id;
  }
  return false;
}

// ─── GET /conversations ────────────────────────────────────────────
router.get('/conversations', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { type, archived, lead_category, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;

  let typeFilter = '';
  let archiveFilter = archived === 'true' ? 'AND cp.is_archived = TRUE' : 'AND cp.is_archived = FALSE';
  const params = [userId, +limit, offset];
  let idx = 4;
  let roleScopeFilter = '';
  let categoryFilter = '';

  if (type) {
    typeFilter = `AND c.type = $${idx}`;
    params.push(type);
    idx++;
  }
  if (lead_category && ['trader', 'partner', 'unknown'].includes(lead_category)) {
    categoryFilter = `AND c.type = 'lead' AND EXISTS (
      SELECT 1 FROM leads category_lead
       WHERE category_lead.id = c.lead_id
         AND category_lead.category = $${idx}
    )`;
    params.push(lead_category);
    idx++;
  }

  if (isLeadOnlyChatRole(req.user)) {
    roleScopeFilter = `AND c.type = 'lead'
      AND EXISTS (
        SELECT 1 FROM leads l
         WHERE l.id = c.lead_id
           AND l.deleted_at IS NULL
           AND l.assigned_to_user_id = $1
      )`;
  } else if (req.user.role === 'rm') {
    roleScopeFilter = `AND (
      c.type != 'lead'
      OR EXISTS (
        SELECT 1 FROM leads l
        JOIN users au ON au.id = l.assigned_to_user_id
         WHERE l.id = c.lead_id
           AND l.deleted_at IS NULL
           AND au.report_to_id = $1
           AND au.deleted_at IS NULL
      )
    )`;
  }

  const { rows } = await query(`
    SELECT c.id, c.type, c.title, c.lead_id, c.is_pinned,
      c.created_at, c.updated_at,
      cp.is_muted, cp.is_archived,
      lm.body AS last_message,
      lm.message_type AS last_message_type,
      lm.sender_id AS last_sender_id,
      lm.sender_name AS last_sender_name,
      lm.created_at AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages m
        WHERE m.conversation_id = cp.conversation_id
        AND m.created_at > cp.last_read_at
        AND m.sender_id != $1
        AND m.is_deleted = FALSE
      )::int AS unread_count
    FROM chat_conversations c
    JOIN chat_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
    LEFT JOIN LATERAL (
      SELECT m.body, m.message_type, m.sender_id, u2.full_name AS sender_name, m.created_at
      FROM chat_messages m
      JOIN users u2 ON u2.id = m.sender_id
      WHERE m.conversation_id = c.id AND m.is_deleted = FALSE
      ORDER BY m.created_at DESC LIMIT 1
    ) lm ON TRUE
    WHERE c.is_deleted = FALSE ${typeFilter} ${archiveFilter} ${roleScopeFilter} ${categoryFilter}
    ORDER BY c.is_pinned DESC, COALESCE(lm.created_at, c.created_at) DESC
    LIMIT $2 OFFSET $3
  `, params);

  const directIds = rows.filter(c => c.type === 'direct').map(c => c.id);
  const leadIds = rows.filter(c => c.type === 'lead' && c.lead_id).map(c => c.lead_id);

  const otherUsersMap = {};
  if (directIds.length) {
    const { rows: parts } = await query(`
      SELECT cp.conversation_id, u.id, u.full_name, u.role, u.status, u.email, u.last_seen_at
      FROM chat_participants cp JOIN users u ON u.id = cp.user_id
      WHERE cp.conversation_id = ANY($1) AND cp.user_id != $2
    `, [directIds, userId]);
    for (const p of parts) otherUsersMap[p.conversation_id] = p;
  }

  const leadsMap = {};
  if (leadIds.length) {
    const { rows: leads } = await query(
      `SELECT id, full_name, phone, email, category, category_source, campaign_name, meta_campaign_id, meta_form_id
         FROM leads WHERE id = ANY($1)`, [leadIds]
    );
    for (const l of leads) leadsMap[l.id] = l;
  }

  for (const conv of rows) {
    conv.other_user = conv.type === 'direct' ? (otherUsersMap[conv.id] || null) : undefined;
    conv.lead = conv.type === 'lead' && conv.lead_id ? (leadsMap[conv.lead_id] || null) : undefined;
  }

  res.json({ success: true, data: rows });
}));

// ─── POST /conversations ──────────────────────────────────────────
router.post('/conversations', asyncHandler(async (req, res) => {
  const sender = req.user;
  const { type = 'direct', target_user_id, lead_id, title } = req.body;

  if (isLeadOnlyChatRole(sender) && type !== 'lead') throw directChatDisabledError();

  if (type === 'direct') {
    if (!target_user_id) throw new AppError(400, 'MISSING_TARGET', 'target_user_id is required');
    const allowed = await canMessage(sender, target_user_id);
    if (!allowed) throw new AppError(403, 'FORBIDDEN', 'You cannot message this user');

    const { rows: existing } = await query(`
      SELECT c.id FROM chat_conversations c
      WHERE c.type = 'direct' AND c.is_deleted = FALSE
        AND EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = c.id AND user_id = $1)
        AND EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = c.id AND user_id = $2)
    `, [sender.id, target_user_id]);

    if (existing.length) {
      return res.json({ success: true, data: { id: existing[0].id, existing: true } });
    }

    const conv = await withTransaction(async (client) => {
      const { rows: [c] } = await client.query(
        `INSERT INTO chat_conversations (type, created_by) VALUES ('direct', $1) RETURNING *`,
        [sender.id]
      );
      await client.query(
        `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
        [c.id, sender.id, target_user_id]
      );
      return c;
    });
    return res.status(201).json({ success: true, data: { id: conv.id, existing: false } });
  }

  if (type === 'lead') {
    if (!lead_id) throw new AppError(400, 'MISSING_LEAD', 'lead_id is required');
    const conv = await getOrCreateLeadConversation({ leadId: lead_id, user: sender });
    return res.status(conv.existing ? 200 : 201).json({ success: true, data: { id: conv.conversationId, existing: conv.existing } });
  }

  if (type === 'broadcast') {
    if (sender.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Only admin can create broadcasts');
    const conv = await withTransaction(async (client) => {
      const { rows: [c] } = await client.query(
        `INSERT INTO chat_conversations (type, title, created_by) VALUES ('broadcast', $1, $2) RETURNING *`,
        [title || 'Broadcast', sender.id]
      );
      const { rows: allUsers } = await client.query(
        `SELECT id FROM users WHERE deleted_at IS NULL AND status = 'active'`
      );
      for (const u of allUsers) {
        await client.query(
          `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [c.id, u.id]
        );
      }
      return c;
    });
    return res.status(201).json({ success: true, data: { id: conv.id, existing: false } });
  }

  throw new AppError(400, 'INVALID_TYPE', 'type must be direct, lead, or broadcast');
}));

// ─── GET /conversations/:id/messages ───────────────────────────────
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;

  const { rows } = await query(`
    SELECT m.id, m.sender_id, u.full_name AS sender_name, u.role AS sender_role,
      m.body, m.message_type, m.metadata, m.created_at, m.edited_at,
      m.reply_to_id, m.is_deleted, m.forwarded_from_id,
      COALESCE(
        (SELECT json_agg(json_build_object('id', a.id, 'file_name', a.file_name, 'file_type', a.file_type, 'file_size', a.file_size, 'file_path', a.file_path))
         FROM chat_attachments a WHERE a.message_id = m.id), '[]'::json
      ) AS attachments,
      COALESCE(
        (SELECT json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id, 'user_name', ru.full_name))
         FROM chat_reactions r JOIN users ru ON ru.id = r.user_id WHERE r.message_id = m.id), '[]'::json
      ) AS reactions,
      EXISTS(SELECT 1 FROM chat_starred_messages sm WHERE sm.message_id = m.id AND sm.user_id = $3) AS is_starred,
      EXISTS(SELECT 1 FROM chat_pinned_messages pm WHERE pm.message_id = m.id AND pm.conversation_id = $1) AS is_pinned,
      COALESCE(
        (SELECT json_agg(cm.user_id) FROM chat_mentions cm WHERE cm.message_id = m.id), '[]'::json
      ) AS mentions
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = $1
      AND NOT EXISTS (SELECT 1 FROM chat_deleted_for_user dfu WHERE dfu.message_id = m.id AND dfu.user_id = $3)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT $2 OFFSET $4
  `, [convId, +limit, userId, offset]);

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM chat_messages WHERE conversation_id = $1`, [convId]
  );

  const replyIds = rows.filter(m => m.reply_to_id).map(m => m.reply_to_id);
  let replyMap = {};
  if (replyIds.length) {
    const { rows: replies } = await query(`
      SELECT m.id, m.body, m.sender_id, u.full_name AS sender_name
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.id = ANY($1)
    `, [replyIds]);
    for (const r of replies) replyMap[r.id] = r;
  }

  const fwdIds = rows.filter(m => m.forwarded_from_id).map(m => m.forwarded_from_id);
  let fwdMap = {};
  if (fwdIds.length) {
    const { rows: fwds } = await query(`
      SELECT m.id, m.body, u.full_name AS sender_name, c.title AS conv_title, c.type AS conv_type
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.id = ANY($1)
    `, [fwdIds]);
    for (const f of fwds) fwdMap[f.id] = f;
  }

  // Read status for sent messages
  const myMsgIds = rows.filter(m => m.sender_id === userId).map(m => m.id);
  let statusMap = {};
  if (myMsgIds.length) {
    const { rows: statuses } = await query(`
      SELECT message_id,
        bool_and(delivered_at IS NOT NULL) AS all_delivered,
        bool_and(read_at IS NOT NULL) AS all_read
      FROM chat_message_status
      WHERE message_id = ANY($1)
      GROUP BY message_id
    `, [myMsgIds]);
    for (const s of statuses) statusMap[s.message_id] = s;
  }

  const enriched = rows.reverse().map(m => ({
    ...m,
    body: m.is_deleted ? 'This message was deleted' : m.body,
    reply_to: m.reply_to_id ? replyMap[m.reply_to_id] || null : null,
    forwarded_from: m.forwarded_from_id ? fwdMap[m.forwarded_from_id] || null : null,
    delivery_status: m.sender_id === userId
      ? (statusMap[m.id]?.all_read ? 'read' : statusMap[m.id]?.all_delivered ? 'delivered' : 'sent')
      : undefined,
  }));

  res.json({ success: true, data: { messages: enriched, total: count, page: +page } });
}));

// ─── POST /conversations/:id/messages ──────────────────────────────
router.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { body, message_type = 'text', reply_to_id, forwarded_from_id } = req.body;
  if (!body || !body.trim()) throw new AppError(400, 'EMPTY_MESSAGE', 'Message body is required');

  const { rows: [msg] } = await query(`
    INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, reply_to_id, forwarded_from_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [convId, userId, body.trim(), message_type, reply_to_id || null, forwarded_from_id || null]);

  await query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [convId]);
  await query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );

  const { rows: [sender] } = await query(
    `SELECT full_name, role FROM users WHERE id = $1`, [userId]
  );

  // Create delivery status for all other participants
  const { rows: participants } = await query(
    `SELECT user_id FROM chat_participants WHERE conversation_id = $1 AND user_id != $2 AND is_blocked = FALSE`,
    [convId, userId]
  );
  for (const p of participants) {
    await query(
      `INSERT INTO chat_message_status (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [msg.id, p.user_id]
    );
  }

  const fullMsg = {
    ...msg,
    sender_name: sender.full_name,
    sender_role: sender.role,
    attachments: [],
    reactions: [],
    reply_to: null,
    forwarded_from: null,
    delivery_status: 'sent',
    is_starred: false,
  };

  if (reply_to_id) {
    const { rows: replyRows } = await query(
      `SELECT m.id, m.body, m.sender_id, u.full_name AS sender_name FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
      [reply_to_id]
    );
    fullMsg.reply_to = replyRows[0] || null;
  }

  if (forwarded_from_id) {
    const { rows: fwdRows } = await query(
      `SELECT m.id, m.body, u.full_name AS sender_name FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
      [forwarded_from_id]
    );
    fullMsg.forwarded_from = fwdRows[0] || null;
  }

  emitToConversation(convId, 'message:new', fullMsg);

  for (const p of participants) {
    await query(`
      INSERT INTO chat_notifications (user_id, type, title, body, conversation_id, sender_id)
      VALUES ($1, 'message', $2, $3, $4, $5)
    `, [p.user_id, `Message from ${sender.full_name}`, body.trim().slice(0, 100), convId, userId]);

    emitToUser(p.user_id, 'notification:new', {
      type: 'message', conversationId: convId,
      senderName: sender.full_name, preview: body.trim().slice(0, 80),
    });
    emitToUser(p.user_id, 'unread:update', { conversationId: convId });
  }

  res.status(201).json({ success: true, data: fullMsg });
}));

// ─── PUT /messages/:id ── edit message ─────────────────────────────
router.put('/messages/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;
  const { body } = req.body;
  if (!body || !body.trim()) throw new AppError(400, 'EMPTY', 'Body required');

  const { rows: msgs } = await query(
    `SELECT sender_id, conversation_id, body AS original_body, original_body AS saved_original FROM chat_messages WHERE id = $1`,
    [msgId]
  );
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);
  if (msgs[0].sender_id !== userId) throw new AppError(403, 'FORBIDDEN', 'Only sender can edit');

  const origBody = msgs[0].saved_original || msgs[0].original_body;
  await query(
    `UPDATE chat_messages SET body = $1, edited_at = NOW(), original_body = COALESCE(original_body, $2) WHERE id = $3`,
    [body.trim(), origBody, msgId]
  );

  emitToConversation(msgs[0].conversation_id, 'message:edited', {
    messageId: msgId, body: body.trim(), edited_at: new Date().toISOString(),
  });

  res.json({ success: true });
}));

// ─── POST /messages/:id/forward ── forward message ─────────────────
router.post('/messages/:id/forward', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;
  const { conversation_id: targetConvId } = req.body;
  if (!targetConvId) throw new AppError(400, 'MISSING', 'conversation_id required');

  const { rows: msgs } = await query(`SELECT body, message_type, metadata, conversation_id FROM chat_messages WHERE id = $1`, [msgId]);
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);
  await assertConversationAccess(req.user, targetConvId);

  const { rows: [sender] } = await query(`SELECT full_name, role FROM users WHERE id = $1`, [userId]);

  const { rows: [fwd] } = await query(`
    INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, metadata, forwarded_from_id)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [targetConvId, userId, msgs[0].body, msgs[0].message_type, msgs[0].metadata, msgId]);

  // Copy attachments
  const { rows: origAttachments } = await query(`SELECT * FROM chat_attachments WHERE message_id = $1`, [msgId]);
  const newAttachments = [];
  for (const att of origAttachments) {
    const { rows: [na] } = await query(`
      INSERT INTO chat_attachments (message_id, conversation_id, uploader_id, file_name, file_type, file_size, file_path)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [fwd.id, targetConvId, userId, att.file_name, att.file_type, att.file_size, att.file_path]);
    newAttachments.push(na);
  }

  await query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [targetConvId]);

  const fullMsg = {
    ...fwd, sender_name: sender.full_name, sender_role: sender.role,
    attachments: newAttachments, reactions: [], reply_to: null,
    forwarded_from: { id: msgId, body: msgs[0].body },
    delivery_status: 'sent', is_starred: false,
  };

  emitToConversation(targetConvId, 'message:new', fullMsg);
  res.status(201).json({ success: true, data: fullMsg });
}));

// ─── POST /conversations/:id/upload ── file attachment ─────────────
router.post('/conversations/:id/upload', upload.single('file'), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  if (!req.file) throw new AppError(400, 'NO_FILE', 'No file uploaded');

  const { rows: [sender] } = await query(`SELECT full_name, role FROM users WHERE id = $1`, [userId]);

  const fileInfo = {
    file_name: req.file.originalname,
    file_type: req.file.mimetype,
    file_size: req.file.size,
    file_path: `/uploads/chat/${req.file.filename}`,
  };

  const msgType = /audio\/(ogg|webm|wav|mp3|mpeg)/.test(req.file.mimetype) ? 'voice' : 'file';

  const { rows: [msg] } = await query(`
    INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [convId, userId, fileInfo.file_name, msgType, JSON.stringify(fileInfo)]);

  const { rows: [attachment] } = await query(`
    INSERT INTO chat_attachments (message_id, conversation_id, uploader_id, file_name, file_type, file_size, file_path)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [msg.id, convId, userId, fileInfo.file_name, fileInfo.file_type, fileInfo.file_size, fileInfo.file_path]);

  await query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [convId]);
  await query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );

  const fullMsg = {
    ...msg, sender_name: sender.full_name, sender_role: sender.role,
    attachments: [attachment], reactions: [], reply_to: null,
    forwarded_from: null, delivery_status: 'sent', is_starred: false,
  };

  emitToConversation(convId, 'message:new', fullMsg);

  const { rows: participants } = await query(
    `SELECT user_id FROM chat_participants WHERE conversation_id = $1 AND user_id != $2 AND is_blocked = FALSE`,
    [convId, userId]
  );
  for (const p of participants) {
    await query(
      `INSERT INTO chat_message_status (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [msg.id, p.user_id]
    );
    emitToUser(p.user_id, 'notification:new', {
      type: msgType, conversationId: convId,
      senderName: sender.full_name, preview: msgType === 'voice' ? 'Sent a voice note' : `Sent a file: ${fileInfo.file_name}`,
    });
    emitToUser(p.user_id, 'unread:update', { conversationId: convId });
  }

  res.status(201).json({ success: true, data: fullMsg });
}));

// ─── POST /conversations/:id/read ──────────────────────────────────
router.post('/conversations/:id/read', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  await query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );
  await query(
    `UPDATE chat_notifications SET is_read = TRUE WHERE user_id = $1 AND conversation_id = $2 AND is_read = FALSE`,
    [userId, convId]
  );

  // Mark messages as read
  await query(`
    UPDATE chat_message_status SET read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
    WHERE user_id = $1 AND read_at IS NULL
      AND message_id IN (SELECT id FROM chat_messages WHERE conversation_id = $2)
  `, [userId, convId]);

  emitToConversation(convId, 'message:read', { userId, conversationId: convId });
  res.json({ success: true });
}));

// ─── POST /conversations/:id/delivered ─────────────────────────────
router.post('/conversations/:id/delivered', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  await query(`
    UPDATE chat_message_status SET delivered_at = NOW()
    WHERE user_id = $1 AND delivered_at IS NULL
      AND message_id IN (SELECT id FROM chat_messages WHERE conversation_id = $2)
  `, [userId, convId]);

  emitToConversation(convId, 'message:delivered', { userId, conversationId: convId });
  res.json({ success: true });
}));

// ─── POST /messages/:id/react ── add/remove reaction ───────────────
router.post('/messages/:id/react', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;
  const { emoji } = req.body;
  if (!emoji) throw new AppError(400, 'MISSING_EMOJI', 'emoji is required');

  const { rows: msgs } = await query(`SELECT conversation_id FROM chat_messages WHERE id = $1`, [msgId]);
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);

  const { rows: existing } = await query(
    `SELECT id FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [msgId, userId, emoji]
  );

  if (existing.length) {
    await query(`DELETE FROM chat_reactions WHERE id = $1`, [existing[0].id]);
  } else {
    await query(
      `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`,
      [msgId, userId, emoji]
    );
  }

  const { rows: reactions } = await query(`
    SELECT r.emoji, r.user_id, u.full_name AS user_name
    FROM chat_reactions r JOIN users u ON u.id = r.user_id
    WHERE r.message_id = $1
  `, [msgId]);

  emitToConversation(msgs[0].conversation_id, 'message:reaction', { messageId: msgId, reactions });
  res.json({ success: true, data: reactions });
}));

// ─── POST /messages/:id/star ── toggle star ────────────────────────
router.post('/messages/:id/star', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;
  const { rows: msgs } = await query(`SELECT conversation_id FROM chat_messages WHERE id = $1`, [msgId]);
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);

  const { rows: existing } = await query(
    `SELECT id FROM chat_starred_messages WHERE message_id = $1 AND user_id = $2`,
    [msgId, userId]
  );

  if (existing.length) {
    await query(`DELETE FROM chat_starred_messages WHERE id = $1`, [existing[0].id]);
    res.json({ success: true, data: { starred: false } });
  } else {
    await query(
      `INSERT INTO chat_starred_messages (message_id, user_id) VALUES ($1, $2)`,
      [msgId, userId]
    );
    res.json({ success: true, data: { starred: true } });
  }
}));

// ─── GET /starred ── list starred messages ─────────────────────────
router.get('/starred', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { rows } = await query(`
    SELECT m.id, m.body, m.message_type, m.created_at, m.conversation_id,
      u.full_name AS sender_name, c.title AS conv_title, c.type AS conv_type
    FROM chat_starred_messages sm
    JOIN chat_messages m ON m.id = sm.message_id
    JOIN users u ON u.id = m.sender_id
    JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE sm.user_id = $1 AND m.is_deleted = FALSE
    ORDER BY sm.created_at DESC
    LIMIT 100
  `, [userId]);

  res.json({ success: true, data: rows });
}));

// ─── DELETE /messages/:id ── delete message ────────────────────────
router.delete('/messages/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;

  const { rows: msgs } = await query(
    `SELECT sender_id, conversation_id FROM chat_messages WHERE id = $1`, [msgId]
  );
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);

  if (msgs[0].sender_id !== userId && req.user.role !== 'super_admin') {
    throw new AppError(403, 'FORBIDDEN', 'Only sender or admin can delete');
  }

  await query(`UPDATE chat_messages SET is_deleted = TRUE, body = '' WHERE id = $1`, [msgId]);
  emitToConversation(msgs[0].conversation_id, 'message:deleted', { messageId: msgId });
  res.json({ success: true });
}));

// ─── PATCH /conversations/:id/pin ──────────────────────────────────
router.patch('/conversations/:id/pin', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { rows } = await query(`SELECT is_pinned FROM chat_conversations WHERE id = $1`, [convId]);
  const newVal = !rows[0].is_pinned;
  await query(`UPDATE chat_conversations SET is_pinned = $1 WHERE id = $2`, [newVal, convId]);
  res.json({ success: true, data: { is_pinned: newVal } });
}));

// ─── PATCH /conversations/:id/mute ─────────────────────────────────
router.patch('/conversations/:id/mute', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { rows } = await query(
    `SELECT is_muted FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );
  if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Not in conversation');

  const newVal = !rows[0].is_muted;
  await query(
    `UPDATE chat_participants SET is_muted = $1 WHERE conversation_id = $2 AND user_id = $3`,
    [newVal, convId, userId]
  );
  res.json({ success: true, data: { is_muted: newVal } });
}));

// ─── PATCH /conversations/:id/archive ──────────────────────────────
router.patch('/conversations/:id/archive', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { rows } = await query(
    `SELECT is_archived FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );
  if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Not in conversation');

  const newVal = !rows[0].is_archived;
  await query(
    `UPDATE chat_participants SET is_archived = $1 WHERE conversation_id = $2 AND user_id = $3`,
    [newVal, convId, userId]
  );
  res.json({ success: true, data: { is_archived: newVal } });
}));

// ─── GET /unread ───────────────────────────────────────────────────
router.get('/unread', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const roleScopeFilter = isLeadOnlyChatRole(req.user)
    ? `AND c.type = 'lead'
       AND EXISTS (
         SELECT 1 FROM leads l
          WHERE l.id = c.lead_id
            AND l.deleted_at IS NULL
            AND l.assigned_to_user_id = $1
       )`
    : '';
  const { rows: [{ count }] } = await query(`
    SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM chat_messages m
        WHERE m.conversation_id = cp.conversation_id
        AND m.created_at > cp.last_read_at
        AND m.sender_id != $1
        AND m.is_deleted = FALSE)
    ), 0)::int AS count
    FROM chat_participants cp
    JOIN chat_conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = $1 AND c.is_deleted = FALSE AND cp.is_archived = FALSE ${roleScopeFilter}
  `, [userId]);

  res.json({ success: true, data: { unread: count } });
}));

// ─── GET /contacts ─────────────────────────────────────────────────
router.get('/contacts', asyncHandler(async (req, res) => {
  const user = req.user;
  let contactQuery;
  const params = [];

  if (isLeadOnlyChatRole(user)) {
    return res.json({ success: true, data: [] });
  }

  if (user.role === 'super_admin' || user.role === 'admin') {
    contactQuery = `
      SELECT id, full_name, role, email, status, last_seen_at
      FROM users WHERE deleted_at IS NULL AND status = 'active' AND id != $1
      ORDER BY role, full_name
    `;
    params.push(user.id);
  } else if (user.role === 'rm') {
    contactQuery = `
      SELECT id, full_name, role, email, status, last_seen_at
      FROM users
      WHERE deleted_at IS NULL AND status = 'active' AND id != $1
        AND (role = 'super_admin' OR report_to_id = $1)
      ORDER BY role, full_name
    `;
    params.push(user.id);
  } else {
    contactQuery = `
      SELECT id, full_name, role, email, status, last_seen_at
      FROM users
      WHERE deleted_at IS NULL AND status = 'active' AND id != $1
        AND (role = 'super_admin' OR id = $2)
      ORDER BY role, full_name
    `;
    params.push(user.id, user.report_to_id);
  }

  const { rows } = await query(contactQuery, params);
  res.json({ success: true, data: rows });
}));

// ─── GET /conversations/:id/participants ───────────────────────────
router.get('/conversations/:id/participants', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { rows } = await query(`
    SELECT u.id, u.full_name, u.role, u.status, u.email, u.last_seen_at,
      cp.joined_at, cp.last_read_at, cp.is_muted, cp.is_blocked
    FROM chat_participants cp JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id = $1
    ORDER BY u.full_name
  `, [convId]);

  res.json({ success: true, data: rows });
}));

// ─── POST /broadcast ───────────────────────────────────────────────
router.post('/broadcast', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Only admin can broadcast');

  const { title, body } = req.body;
  if (!body || !body.trim()) throw new AppError(400, 'EMPTY', 'Broadcast body required');

  const result = await withTransaction(async (client) => {
    const { rows: [conv] } = await client.query(
      `INSERT INTO chat_conversations (type, title, created_by) VALUES ('broadcast', $1, $2) RETURNING *`,
      [title || 'Broadcast', req.user.id]
    );

    const { rows: users } = await client.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND status = 'active'`
    );
    for (const u of users) {
      await client.query(
        `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [conv.id, u.id]
      );
    }

    const { rows: [msg] } = await client.query(`
      INSERT INTO chat_messages (conversation_id, sender_id, body, message_type)
      VALUES ($1, $2, $3, 'text') RETURNING *
    `, [conv.id, req.user.id, body.trim()]);

    for (const u of users) {
      if (u.id === req.user.id) continue;
      await client.query(`
        INSERT INTO chat_notifications (user_id, type, title, body, conversation_id, sender_id)
        VALUES ($1, 'broadcast', $2, $3, $4, $5)
      `, [u.id, title || 'Broadcast', body.trim().slice(0, 100), conv.id, req.user.id]);

      emitToUser(u.id, 'broadcast:new', {
        conversationId: conv.id, title: title || 'Broadcast',
        preview: body.trim().slice(0, 80), senderName: req.user.full_name,
      });
    }

    return { conv, msg };
  });

  res.status(201).json({ success: true, data: result });
}));

// ─── GET /notifications ────────────────────────────────────────────
router.get('/notifications', asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;

  const { rows } = await query(`
    SELECT n.*, u.full_name AS sender_name
    FROM chat_notifications n
    LEFT JOIN users u ON u.id = n.sender_id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.user.id, +limit, offset]);

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM chat_notifications WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );

  res.json({ success: true, data: { notifications: rows, unread: count } });
}));

// ─── POST /notifications/read-all ──────────────────────────────────
router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await query(
    `UPDATE chat_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );
  res.json({ success: true });
}));

// ─── GET /lead/:leadId/thread ──────────────────────────────────────
router.get('/lead/:leadId/thread', asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { conversationId: convId, lead } = await getOrCreateLeadConversation({ leadId, user: req.user });

  const { rows: messages } = await query(`
    SELECT m.id, m.sender_id, u.full_name AS sender_name, u.role AS sender_role,
      m.body, m.message_type, m.metadata, m.created_at
    FROM chat_messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = $1 AND m.is_deleted = FALSE
    ORDER BY m.created_at ASC
    LIMIT 100
  `, [convId]);

  res.json({ success: true, data: { conversationId: convId, lead, messages } });
}));

// ─── ADMIN: GET /admin/conversations ─────────────────────────────
router.get('/admin/conversations', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');

  const { page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;

  const { rows } = await query(`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM chat_messages WHERE conversation_id = c.id) AS message_count,
      (SELECT COUNT(*)::int FROM chat_participants WHERE conversation_id = c.id) AS participant_count,
      lm.body AS last_message,
      lm.created_at AS last_message_at
    FROM chat_conversations c
    LEFT JOIN LATERAL (
      SELECT body, created_at FROM chat_messages
      WHERE conversation_id = c.id AND is_deleted = FALSE
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) lm ON true
    WHERE c.is_deleted = FALSE
    ORDER BY c.updated_at DESC
    LIMIT $1 OFFSET $2
  `, [+limit, offset]);

  res.json({ success: true, data: rows });
}));

// ─── ADMIN: POST /admin/join/:id ──────────────────────────────────
router.post('/admin/join/:id', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const convId = req.params.id;
  const { rows } = await query(`SELECT id FROM chat_conversations WHERE id = $1 AND is_deleted = FALSE`, [convId]);
  if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
  await query(
    `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [convId, req.user.id]
  );
  res.json({ success: true });
}));

// ─── ADMIN: DELETE /admin/conversations/:id ────────────────────────
router.delete('/admin/conversations/:id', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  await query(`UPDATE chat_conversations SET is_deleted = TRUE WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
}));

// ─── ADMIN: POST /admin/block-user ─────────────────────────────────
router.post('/admin/block-user', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const { conversation_id, user_id, block } = req.body;

  await query(
    `UPDATE chat_participants SET is_blocked = $1 WHERE conversation_id = $2 AND user_id = $3`,
    [block !== false, conversation_id, user_id]
  );
  res.json({ success: true });
}));

// ─── ADMIN: GET /admin/online-users ────────────────────────────────
router.get('/admin/online-users', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');

  const { rows } = await query(`
    SELECT id, full_name, role, email, status, last_seen_at
    FROM users WHERE deleted_at IS NULL AND status = 'active'
    ORDER BY role, full_name
  `);

  res.json({ success: true, data: rows });
}));

// ─── GET /search ── search messages ────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { q, conversation_id } = req.query;
  if (!q || q.length < 2) return res.json({ success: true, data: [] });

  let convFilter = '';
  let roleScopeFilter = '';
  const params = [userId, `%${q}%`];
  if (conversation_id) {
    convFilter = `AND m.conversation_id = $3`;
    params.push(conversation_id);
  }
  if (isLeadOnlyChatRole(req.user)) {
    roleScopeFilter = `AND c.type = 'lead'
      AND EXISTS (
        SELECT 1 FROM leads l
         WHERE l.id = c.lead_id
           AND l.deleted_at IS NULL
           AND l.assigned_to_user_id = $1
      )`;
  }

  const { rows } = await query(`
    SELECT m.id, m.conversation_id, m.body, m.created_at,
      u.full_name AS sender_name, c.type AS conv_type, c.title AS conv_title
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    JOIN chat_conversations c ON c.id = m.conversation_id
    JOIN chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
    WHERE m.body ILIKE $2 AND m.is_deleted = FALSE AND c.is_deleted = FALSE
    ${convFilter} ${roleScopeFilter}
    ORDER BY m.created_at DESC
    LIMIT 30
  `, params);

  res.json({ success: true, data: rows });
}));

// ─── POST /messages/:id/pin ── pin/unpin a message ───────────────
router.post('/messages/:id/pin', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;

  const { rows: msgs } = await query(`SELECT conversation_id FROM chat_messages WHERE id = $1`, [msgId]);
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  const convId = msgs[0].conversation_id;
  await assertConversationAccess(req.user, convId);

  const { rows: existing } = await query(
    `SELECT id FROM chat_pinned_messages WHERE message_id = $1 AND conversation_id = $2`,
    [msgId, convId]
  );

  if (existing.length) {
    await query(`DELETE FROM chat_pinned_messages WHERE id = $1`, [existing[0].id]);
    emitToConversation(convId, 'message:pinned', { messageId: msgId, pinned: false });
    return res.json({ success: true, data: { pinned: false } });
  }

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM chat_pinned_messages WHERE conversation_id = $1`, [convId]
  );
  if (count >= 5) throw new AppError(400, 'MAX_PINS', 'Maximum 5 pinned messages per conversation');

  await query(
    `INSERT INTO chat_pinned_messages (message_id, conversation_id, pinned_by) VALUES ($1, $2, $3)`,
    [msgId, convId, userId]
  );
  emitToConversation(convId, 'message:pinned', { messageId: msgId, pinned: true });
  res.json({ success: true, data: { pinned: true } });
}));

// ─── GET /conversations/:id/pinned ── get pinned messages ────────
router.get('/conversations/:id/pinned', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { rows } = await query(`
    SELECT m.id, m.body, m.message_type, m.created_at, u.full_name AS sender_name,
      pu.full_name AS pinned_by_name, pm.created_at AS pinned_at
    FROM chat_pinned_messages pm
    JOIN chat_messages m ON m.id = pm.message_id
    JOIN users u ON u.id = m.sender_id
    JOIN users pu ON pu.id = pm.pinned_by
    WHERE pm.conversation_id = $1 AND m.is_deleted = FALSE
    ORDER BY pm.created_at DESC
  `, [convId]);

  res.json({ success: true, data: rows });
}));

// ─── DELETE /messages/:id/for-me ── delete for current user only ─
router.delete('/messages/:id/for-me', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const msgId = req.params.id;

  const { rows: msgs } = await query(`SELECT conversation_id FROM chat_messages WHERE id = $1`, [msgId]);
  if (!msgs.length) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertConversationAccess(req.user, msgs[0].conversation_id);

  await query(
    `INSERT INTO chat_deleted_for_user (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [msgId, userId]
  );
  res.json({ success: true });
}));

// ─── POST /messages/:id/mentions ── extract and store @mentions ──
router.post('/conversations/:id/messages/with-mentions', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  const { body, message_type = 'text', reply_to_id, mentions = [] } = req.body;
  if (!body || !body.trim()) throw new AppError(400, 'EMPTY_MESSAGE', 'Message body is required');

  const { rows: [msg] } = await query(`
    INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, reply_to_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [convId, userId, body.trim(), message_type, reply_to_id || null]);

  await query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [convId]);
  await query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );

  const { rows: [sender] } = await query(`SELECT full_name, role FROM users WHERE id = $1`, [userId]);

  // Store mentions
  for (const mentionedUserId of mentions) {
    await query(
      `INSERT INTO chat_mentions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [msg.id, mentionedUserId]
    );
  }

  const { rows: participants } = await query(
    `SELECT user_id FROM chat_participants WHERE conversation_id = $1 AND user_id != $2 AND is_blocked = FALSE`,
    [convId, userId]
  );

  for (const p of participants) {
    await query(
      `INSERT INTO chat_message_status (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [msg.id, p.user_id]
    );
  }

  const fullMsg = {
    ...msg, sender_name: sender.full_name, sender_role: sender.role,
    attachments: [], reactions: [], reply_to: null, forwarded_from: null,
    delivery_status: 'sent', is_starred: false, mentions,
  };

  if (reply_to_id) {
    const { rows: rr } = await query(
      `SELECT m.id, m.body, m.sender_id, u.full_name AS sender_name FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
      [reply_to_id]
    );
    fullMsg.reply_to = rr[0] || null;
  }

  emitToConversation(convId, 'message:new', fullMsg);

  // Send mention notifications specifically
  for (const mentionedUserId of mentions) {
    if (mentionedUserId === userId) continue;
    await query(`
      INSERT INTO chat_notifications (user_id, type, title, body, conversation_id, sender_id)
      VALUES ($1, 'mention', $2, $3, $4, $5)
    `, [mentionedUserId, `${sender.full_name} mentioned you`, body.trim().slice(0, 100), convId, userId]);

    emitToUser(mentionedUserId, 'notification:new', {
      type: 'mention', conversationId: convId,
      senderName: sender.full_name, preview: body.trim().slice(0, 80),
    });
  }

  for (const p of participants) {
    if (mentions.includes(p.user_id)) continue;
    await query(`
      INSERT INTO chat_notifications (user_id, type, title, body, conversation_id, sender_id)
      VALUES ($1, 'message', $2, $3, $4, $5)
    `, [p.user_id, `Message from ${sender.full_name}`, body.trim().slice(0, 100), convId, userId]);
    emitToUser(p.user_id, 'notification:new', {
      type: 'message', conversationId: convId,
      senderName: sender.full_name, preview: body.trim().slice(0, 80),
    });
    emitToUser(p.user_id, 'unread:update', { conversationId: convId });
  }

  res.status(201).json({ success: true, data: fullMsg });
}));

// ─── GET /mentions ── get messages where user is mentioned ───────
router.get('/mentions', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { rows } = await query(`
    SELECT m.id, m.body, m.message_type, m.created_at, m.conversation_id,
      u.full_name AS sender_name, c.title AS conv_title, c.type AS conv_type
    FROM chat_mentions cm
    JOIN chat_messages m ON m.id = cm.message_id
    JOIN users u ON u.id = m.sender_id
    JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE cm.user_id = $1 AND m.is_deleted = FALSE
    ORDER BY m.created_at DESC
    LIMIT 50
  `, [userId]);

  res.json({ success: true, data: rows });
}));

// ─── ADMIN: POST /admin/mute-user ── mute/unmute user in conv ────
router.post('/admin/mute-user', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const { conversation_id, user_id, mute } = req.body;

  await query(
    `UPDATE chat_participants SET is_muted = $1 WHERE conversation_id = $2 AND user_id = $3`,
    [mute !== false, conversation_id, user_id]
  );
  res.json({ success: true });
}));

// ─── ADMIN: GET /admin/blocked-users ─────────────────────────────
router.get('/admin/blocked-users', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');

  const { rows } = await query(`
    SELECT cp.conversation_id, cp.user_id, u.full_name, u.email, u.role,
      c.title AS conv_title, c.type AS conv_type
    FROM chat_participants cp
    JOIN users u ON u.id = cp.user_id
    JOIN chat_conversations c ON c.id = cp.conversation_id
    WHERE cp.is_blocked = TRUE AND c.is_deleted = FALSE
    ORDER BY u.full_name
  `);

  res.json({ success: true, data: rows });
}));

// ─── ADMIN: GET /admin/export/:id ── export chat as JSON ─────────
router.get('/admin/export/:id', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const convId = req.params.id;

  const { rows: convRows } = await query(`SELECT * FROM chat_conversations WHERE id = $1`, [convId]);
  if (!convRows.length) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');

  const { rows: messages } = await query(`
    SELECT m.id, m.body, m.message_type, m.created_at, m.edited_at, m.is_deleted,
      u.full_name AS sender_name, u.role AS sender_role,
      COALESCE(
        (SELECT json_agg(json_build_object('file_name', a.file_name, 'file_type', a.file_type, 'file_size', a.file_size))
         FROM chat_attachments a WHERE a.message_id = m.id), '[]'::json
      ) AS attachments
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = $1
    ORDER BY m.created_at ASC
  `, [convId]);

  const { rows: participants } = await query(`
    SELECT u.full_name, u.role, u.email FROM chat_participants cp
    JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = $1
  `, [convId]);

  await query(
    `INSERT INTO chat_export_logs (conversation_id, exported_by) VALUES ($1, $2)`,
    [convId, req.user.id]
  );

  res.json({
    success: true,
    data: {
      conversation: convRows[0],
      participants,
      messages,
      exported_at: new Date().toISOString(),
      exported_by: req.user.full_name,
      total_messages: messages.length,
    }
  });
}));

// ─── ADMIN: GET /admin/search ── global search across all chats ──
router.get('/admin/search', asyncHandler(async (req, res) => {
  if (req.user.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Admin only');
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ success: true, data: [] });

  const { rows } = await query(`
    SELECT m.id, m.conversation_id, m.body, m.created_at, m.message_type,
      u.full_name AS sender_name, u.role AS sender_role,
      c.type AS conv_type, c.title AS conv_title
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE m.body ILIKE $1 AND m.is_deleted = FALSE AND c.is_deleted = FALSE
    ORDER BY m.created_at DESC
    LIMIT 50
  `, [`%${q}%`]);

  res.json({ success: true, data: rows });
}));

// ─── POST /conversations/:id/upload-multi ── multiple files ──────
router.post('/conversations/:id/upload-multi', upload.array('files', 10), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const convId = req.params.id;
  await assertConversationAccess(req.user, convId);

  if (!req.files || !req.files.length) throw new AppError(400, 'NO_FILES', 'No files uploaded');

  const { rows: [sender] } = await query(`SELECT full_name, role FROM users WHERE id = $1`, [userId]);
  const results = [];

  for (const file of req.files) {
    const fileInfo = {
      file_name: file.originalname,
      file_type: file.mimetype,
      file_size: file.size,
      file_path: `/uploads/chat/${file.filename}`,
    };

    const msgType = /audio\/(ogg|webm|wav|mp3|mpeg)/.test(file.mimetype) ? 'voice' : 'file';

    const { rows: [msg] } = await query(`
      INSERT INTO chat_messages (conversation_id, sender_id, body, message_type, metadata)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [convId, userId, fileInfo.file_name, msgType, JSON.stringify(fileInfo)]);

    const { rows: [attachment] } = await query(`
      INSERT INTO chat_attachments (message_id, conversation_id, uploader_id, file_name, file_type, file_size, file_path)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [msg.id, convId, userId, fileInfo.file_name, fileInfo.file_type, fileInfo.file_size, fileInfo.file_path]);

    const fullMsg = {
      ...msg, sender_name: sender.full_name, sender_role: sender.role,
      attachments: [attachment], reactions: [], reply_to: null,
      forwarded_from: null, delivery_status: 'sent', is_starred: false,
    };

    emitToConversation(convId, 'message:new', fullMsg);
    results.push(fullMsg);
  }

  await query(`UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`, [convId]);
  await query(
    `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );

  const { rows: participants } = await query(
    `SELECT user_id FROM chat_participants WHERE conversation_id = $1 AND user_id != $2 AND is_blocked = FALSE`,
    [convId, userId]
  );
  for (const p of participants) {
    for (const r of results) {
      await query(
        `INSERT INTO chat_message_status (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [r.id, p.user_id]
      );
    }
    emitToUser(p.user_id, 'notification:new', {
      type: 'file', conversationId: convId,
      senderName: sender.full_name, preview: `Sent ${req.files.length} file(s)`,
    });
    emitToUser(p.user_id, 'unread:update', { conversationId: convId });
  }

  res.status(201).json({ success: true, data: results });
}));

module.exports = router;
