const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../config/database');
const logger = require('../utils/logger');

let io = null;

function initSocket(httpServer) {
  const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',').map(s => s.trim());

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));
      const decoded = verifyAccessToken(token);
      const { rows } = await query(
        `SELECT id, role, full_name, status FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [decoded.sub]
      );
      if (!rows.length || rows[0].status !== 'active') return next(new Error('INVALID_USER'));
      socket.userId = rows[0].id;
      socket.userRole = rows[0].role;
      socket.userName = rows[0].full_name;
      next();
    } catch (err) {
      logger.warn({ err: err.message }, 'Socket auth failed');
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ userId: socket.userId, role: socket.userRole }, 'Socket connected');

    socket.join(`user:${socket.userId}`);
    socket.join(`role:${socket.userRole}`);

    query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [socket.userId]).catch(() => {});
    socket.broadcast.emit('user:online', { userId: socket.userId, userName: socket.userName });

    socket.on('join:conversation', async (conversationId) => {
      if (!conversationId || typeof conversationId !== 'string') return;
      try {
        const { rows } = await query(
          `SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2 AND is_blocked = FALSE`,
          [conversationId, socket.userId]
        );
        if (rows.length) {
          socket.join(`conv:${conversationId}`);
        }
      } catch {
        // silently ignore — don't crash on bad IDs
      }
    });

    socket.on('leave:conversation', (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    socket.on('typing', (data) => {
      if (!data?.conversationId) return;
      socket.to(`conv:${data.conversationId}`).emit('user:typing', {
        conversationId: data.conversationId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('stop:typing', (data) => {
      if (!data?.conversationId) return;
      socket.to(`conv:${data.conversationId}`).emit('user:stop_typing', {
        conversationId: data.conversationId,
        userId: socket.userId,
      });
    });

    socket.on('recording', (data) => {
      if (!data?.conversationId) return;
      socket.to(`conv:${data.conversationId}`).emit('user:recording', {
        conversationId: data.conversationId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('stop:recording', (data) => {
      if (!data?.conversationId) return;
      socket.to(`conv:${data.conversationId}`).emit('user:stop_recording', {
        conversationId: data.conversationId,
        userId: socket.userId,
      });
    });

    socket.on('disconnect', () => {
      query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [socket.userId]).catch(() => {});
      socket.broadcast.emit('user:offline', { userId: socket.userId });

      // Clean up typing/recording indicators on disconnect
      for (const room of socket.rooms) {
        if (room.startsWith('conv:')) {
          const convId = room.slice(5);
          socket.to(room).emit('user:stop_typing', {
            conversationId: convId,
            userId: socket.userId,
          });
          socket.to(room).emit('user:stop_recording', {
            conversationId: convId,
            userId: socket.userId,
          });
        }
      }

      logger.debug({ userId: socket.userId }, 'Socket disconnected');
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function emitToConversation(conversationId, event, data) {
  if (io) io.to(`conv:${conversationId}`).emit(event, data);
}

function emitToRole(role, event, data) {
  if (io) io.to(`role:${role}`).emit(event, data);
}

module.exports = { initSocket, getIO, emitToUser, emitToConversation, emitToRole };
