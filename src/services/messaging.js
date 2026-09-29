// Sending a message. Used by the plain form AND by Socket.IO,
// so the rules are the same whichever way a message arrives.
const { Message } = require('../models');
const social = require('./social');

const MAX_MESSAGE = 1000;

function roomName(aId, bId) {
  return 'chat:' + Math.min(aId, bId) + '_' + Math.max(aId, bId);
}

// is the recipient looking at this conversation right now?
async function recipientIsWatching(io, room, recipientId) {
  if (!io) return false;
  const sockets = await io.in(room).fetchSockets();
  return sockets.some((s) => s.data.userId === recipientId);
}

// returns { ok: true, message } or { ok: false, reason }
async function sendMessage(io, sender, recipient, rawBody) {
  const body = (rawBody || '').trim();
  if (!body) return { ok: false, reason: 'empty' };
  if (body.length > MAX_MESSAGE) return { ok: false, reason: 'too_long' };

  // checked on the server every single time
  if (!(await social.canMessage(sender, recipient))) return { ok: false, reason: 'unavailable' };

  const message = await Message.create({ senderId: sender.id, recipientId: recipient.id, body });
  const room = roomName(sender.id, recipient.id);

  // only notify if they aren't already reading the conversation
  if (!(await recipientIsWatching(io, room, recipient.id))) {
    await social.addNotification(recipient.id, 'message.new', { senderId: sender.id, name: sender.firstName() }, '/messages/' + sender.id);
  }

  if (io) {
    io.to(room).emit('message:new', {
      id: message.id,
      senderId: sender.id,
      body: message.body,
      createdAt: message.createdAt
    });
  }

  return { ok: true, message };
}

module.exports = { MAX_MESSAGE, roomName, sendMessage };
