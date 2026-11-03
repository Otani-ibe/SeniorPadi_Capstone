// Sends a message. Used by the plain form and by Socket.IO, so the rules are the same either way.
const { Message } = require('../models');
const social = require('./social');

const MAX_MESSAGE = 1000;

function roomName(aId, bId) {
  return 'chat:' + Math.min(aId, bId) + '_' + Math.max(aId, bId);
}

// is the recipient in this conversation right now?
async function recipientIsWatching(io, room, recipientId) {
  if (!io) return false;
  const sockets = await io.in(room).fetchSockets();
  return sockets.some((s) => s.data.userId === recipientId);
}

// -> { ok: true, message } | { ok: false, reason }
async function sendMessage(io, sender, recipient, rawBody) {
  const body = (rawBody || '').trim();
  if (!body) return { ok: false, reason: 'empty' };
  if (body.length > MAX_MESSAGE) return { ok: false, reason: 'too_long' };

  // checked on the server every time
  if (!(await social.canMessage(sender, recipient))) return { ok: false, reason: 'unavailable' };

  const room = roomName(sender.id, recipient.id);
  // conversation open = seen straight away, counts as read
  const watching = await recipientIsWatching(io, room, recipient.id);
  const message = await Message.create({ senderId: sender.id, recipientId: recipient.id, body, readAt: watching ? new Date() : null });

  // no notification if they are already reading it
  if (!watching) {
    await social.addNotification(recipient.id, 'message.new', { senderId: sender.id, name: sender.firstName() }, '/messages/' + sender.id);
  }

  if (io) {
    io.to(room).emit('message:new', {
      id: message.id,
      senderId: sender.id,
      body: message.body,
      kind: 'text',
      createdAt: message.createdAt,
      read: watching
    });
  }

  return { ok: true, message };
}

// a call that rang out is written into the chat as a line from the caller: "Missed call" for the person called, "Call not answered" for the caller.
// not a notification or banner. Counts as an unread message for the person called.
async function addMissedCall(io, caller, callee) {
  const room = roomName(caller.id, callee.id);
  const watching = await recipientIsWatching(io, room, callee.id);
  const message = await Message.create({ senderId: caller.id, recipientId: callee.id, body: '', kind: 'missed_call', readAt: watching ? new Date() : null });
  if (!watching) {
    await social.addNotification(callee.id, 'message.new', { senderId: caller.id, name: caller.firstName() }, '/messages/' + caller.id);
  }
  if (io) {
    io.to(room).emit('message:new', { id: message.id, senderId: caller.id, body: '', kind: 'missed_call', createdAt: message.createdAt, read: watching });
  }
  return message;
}

// an answered call is written into the chat with who called and how long (seconds, in body). Already read.
async function addCallRecord(io, callerId, calleeId, seconds) {
  const room = roomName(callerId, calleeId);
  const message = await Message.create({ senderId: callerId, recipientId: calleeId, body: String(Math.max(0, Math.round(seconds))), kind: 'call', readAt: new Date() });
  if (io) {
    io.to(room).emit('message:new', { id: message.id, senderId: callerId, body: message.body, kind: 'call', createdAt: message.createdAt, read: true });
  }
  return message;
}

// reader opened the conversation: their messages from the other person are read.
// if the sender has it open, "Sent" turns to "Read" without a reload
async function markRead(io, readerId, senderId) {
  const [count] = await Message.update({ readAt: new Date() }, { where: { senderId, recipientId: readerId, readAt: null } });
  if (count > 0 && io) io.to(roomName(readerId, senderId)).emit('messages:read', { readerId });
}

module.exports = { MAX_MESSAGE, roomName, sendMessage, addMissedCall, addCallRecord, markRead };
