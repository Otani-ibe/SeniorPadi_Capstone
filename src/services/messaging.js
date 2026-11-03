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

  const room = roomName(sender.id, recipient.id);
  // if they have the conversation open, they see it straight away, so it counts as read
  const watching = await recipientIsWatching(io, room, recipient.id);
  const message = await Message.create({ senderId: sender.id, recipientId: recipient.id, body, readAt: watching ? new Date() : null });

  // only notify if they aren't already reading the conversation
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

// A call that rang out is written into the chat, as a line from the caller: "Missed call" for the person called,
// "Call not answered" for the caller. It is not a notification and not a banner: the chat is where it lives.
// It counts as an unread message for the person called, like any other message.
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

// A call that was answered is written into the chat as a line saying who called and for how long (in seconds, kept in
// the body). It is already read: a finished call is not news.
async function addCallRecord(io, callerId, calleeId, seconds) {
  const room = roomName(callerId, calleeId);
  const message = await Message.create({ senderId: callerId, recipientId: calleeId, body: String(Math.max(0, Math.round(seconds))), kind: 'call', readAt: new Date() });
  if (io) {
    io.to(room).emit('message:new', { id: message.id, senderId: callerId, body: message.body, kind: 'call', createdAt: message.createdAt, read: true });
  }
  return message;
}

// the reader opened the conversation: their messages from the other person are now read.
// If the sender has it open, their "Sent" changes to "Read" without reloading.
async function markRead(io, readerId, senderId) {
  const [count] = await Message.update({ readAt: new Date() }, { where: { senderId, recipientId: readerId, readAt: null } });
  if (count > 0 && io) io.to(roomName(readerId, senderId)).emit('messages:read', { readerId });
}

module.exports = { MAX_MESSAGE, roomName, sendMessage, addMissedCall, addCallRecord, markRead };
