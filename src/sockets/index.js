// Real-time chat. This only makes messages appear without reloading.
// The normal form still works if any of this fails.
const { Server } = require('socket.io');
const sessionMiddleware = require('../config/session');
const { User } = require('../models');
const social = require('../services/social');
const { roomName, sendMessage } = require('../services/messaging');

const MAX_PER_10_MIN = 60;

// only verified seniors who still exist
async function loadVerifiedSenior(userId) {
  if (!userId) return null;
  const user = await User.findByPk(userId);
  if (!user || user.role !== 'senior' || user.verificationStatus !== 'approved') return null;
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
      socket.data.sentTimes = [];
      next();
    } catch (err) {
      next(new Error('not allowed'));
    }
  });

  io.on('connection', (socket) => {
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
