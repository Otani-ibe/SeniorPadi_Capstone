// Real-time chat. This only makes messages appear without reloading.
// The normal form still works if any of this fails.
const { Server } = require('socket.io');
const sessionMiddleware = require('../config/session');
const { User } = require('../models');
const social = require('../services/social');
const { roomName, sendMessage } = require('../services/messaging');
const presence = require('../services/presence');
const setupCalls = require('./calls');

const MAX_PER_10_MIN = 60;
const MAX_WATCHED = 40;

// only verified seniors who still exist
async function loadVerifiedSenior(userId) {
  if (!userId) return null;
  const user = await User.findByPk(userId);
  if (!user || user.role !== 'senior' || user.verificationStatus !== 'approved') return null;
  if (!user.contactVerified()) return null;
  return user;
}

function setupSockets(httpServer) {
  const io = new Server(httpServer, {
    // refuse connections started from other websites
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const sameSite = !origin || new URL(origin).host === req.headers.host;
      callback(null, sameSite);
    }
  });

  // reuse the Express login session
  io.engine.use(sessionMiddleware);

  // check who is connecting before letting them in
  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      const token = socket.handshake.auth && socket.handshake.auth.csrf;
      if (!session || !token || token !== session.csrfToken) return next(new Error('not allowed'));

      const user = await loadVerifiedSenior(session.userId);
      if (!user) return next(new Error('not allowed'));

      socket.data.userId = user.id;
      socket.data.showStatus = user.showOnlineStatus !== false;
      socket.data.sentTimes = [];
      next();
    } catch (err) {
      next(new Error('not allowed'));
    }
  });

  io.on('connection', (socket) => {
    // online status: tell anyone watching this person when they come online or go offline
    if (presence.connected(socket.data.userId) && socket.data.showStatus) {
      io.to(presence.presenceRoom(socket.data.userId)).emit('presence:update', { id: socket.data.userId, status: 'online' });
    }
    socket.on('disconnect', () => {
      if (presence.disconnected(socket.data.userId) && socket.data.showStatus) {
        io.to(presence.presenceRoom(socket.data.userId)).emit('presence:update', { id: socket.data.userId, status: 'offline' });
      }
    });

    setupCalls(io, socket, loadVerifiedSenior);

    // start watching some people's status: [ids] -> { id: 'online' | 'offline' }
    // only people this senior is allowed to message, and only those who show their status
    socket.on('presence:watch', async (ids, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const me = await loadVerifiedSenior(socket.data.userId);
        if (!me || !Array.isArray(ids)) return reply({});
        const wanted = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_WATCHED);
        const people = await User.findAll({ where: { id: wanted, role: 'senior' } });
        const result = {};
        for (const other of people) {
          if (!(await social.canMessage(me, other))) continue;
          socket.join(presence.presenceRoom(other.id));
          const status = presence.statusOf(other);
          if (status) result[other.id] = status;
        }
        reply(result);
      } catch (err) {
        reply({});
      }
    });

    // open a conversation: { withId }
    socket.on('chat:join', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const me = await loadVerifiedSenior(socket.data.userId);
        const other = await User.findOne({ where: { id: Number(data && data.withId) || 0, role: 'senior' } });
        if (!me || !(await social.canMessage(me, other))) return reply({ ok: false });

        socket.join(roomName(me.id, other.id));
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false });
      }
    });

    // send a message: { recipientId, body }
    socket.on('message:send', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        // simple rate limit, same idea as the form
        const now = Date.now();
        socket.data.sentTimes = socket.data.sentTimes.filter((t) => now - t < 10 * 60 * 1000);
        if (socket.data.sentTimes.length >= MAX_PER_10_MIN) return reply({ ok: false, reason: 'too_many' });

        // load the sender again every time: they could have been removed since connecting
        const me = await loadVerifiedSenior(socket.data.userId);
        const other = await User.findOne({ where: { id: Number(data && data.recipientId) || 0, role: 'senior' } });
        if (!me || !other) return reply({ ok: false, reason: 'unavailable' });

        const result = await sendMessage(io, me, other, data && data.body);
        if (result.ok) socket.data.sentTimes.push(now);
        reply({ ok: result.ok, reason: result.reason });
      } catch (err) {
        console.error('Socket message failed:', err.message);
        reply({ ok: false, reason: 'error' });
      }
    });
  });

  return io;
}

module.exports = setupSockets;
