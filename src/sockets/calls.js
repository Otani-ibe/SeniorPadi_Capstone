// Voice call set-up over Socket.IO, called from sockets/index.js for every connected senior. Rules are checked here every time, same as messages
const { User } = require('../models');
const social = require('../services/social');
const calls = require('../services/calls');
const { addMissedCall, addCallRecord } = require('../services/messaging');

const MAX_INVITES_PER_10_MIN = 10;
const MAX_SIGNAL_BYTES = 20000;

const userRoom = (id) => 'user:' + id;

// io: server, socket: this connection, loadVerifiedSenior: checks they still exist and are approved
function setupCalls(io, socket, loadVerifiedSenior) {
  const myId = socket.data.userId;
  socket.join(userRoom(myId));
  socket.data.inviteTimes = [];

  // finishes a call and tells everyone involved (the other person, and this person's other tabs)
  function finish(call, reason, exceptSocketId) {
    // a call that was answered is kept in the chat, with how long it lasted
    const talked = call.state === 'active' && call.acceptedAt ? Math.round((Date.now() - call.acceptedAt) / 1000) : null;
    calls.end(call);
    for (const id of [call.callerId, call.calleeId]) {
      let target = io.to(userRoom(id));
      if (exceptSocketId) target = target.except(exceptSocketId);
      target.emit('call:ended', { callId: call.id, reason });
    }
    if (talked !== null) {
      addCallRecord(io, call.callerId, call.calleeId, talked).catch((err) => console.error('Could not write the call into the chat:', err.message));
    }
  }

  async function isOnline(userId) {
    return (await io.in(userRoom(userId)).fetchSockets()).length > 0;
  }

  // start a call: { toId } -> { ok, callId } or { ok: false, reason }
  socket.on('call:invite', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const now = Date.now();
      socket.data.inviteTimes = socket.data.inviteTimes.filter((t) => now - t < 10 * 60 * 1000);
      if (socket.data.inviteTimes.length >= MAX_INVITES_PER_10_MIN) return reply({ ok: false, reason: 'too_many' });

      const me = await loadVerifiedSenior(myId);
      const other = await User.findOne({ where: { id: Number(data && data.toId) || 0, role: 'senior' } });
      if (!me || !other || !(await social.canMessage(me, other)) || !(await social.canMessage(other, me))) {
        return reply({ ok: false, reason: 'unavailable' });
      }
      if (calls.isBusy(me.id)) return reply({ ok: false, reason: 'you_busy' });
      if (!(await isOnline(other.id))) {
        // away: the caller is told and a missed call waits in the chat, one line per try.
        // counts toward the call limit (10 in 10 minutes) so it cannot fill someone's chat.
        // the line goes straight back to the caller so it shows at once whatever the connection does
        socket.data.inviteTimes.push(now);
        let line = null;
        try {
          const saved = await addMissedCall(io, me, other);
          line = { id: saved.id, senderId: me.id, body: '', kind: 'missed_call', createdAt: saved.createdAt, read: false };
        } catch (err) {
          console.error('Could not write the missed call into the chat:', err.message);
        }
        return reply({ ok: false, reason: 'offline', line });
      }
      if (calls.isBusy(other.id)) return reply({ ok: false, reason: 'busy' });

      socket.data.inviteTimes.push(now);
      const call = calls.create(me.id, other.id, socket.id);
      io.to(userRoom(other.id)).emit('call:incoming', { callId: call.id, from: { id: me.id, name: me.firstName(), avatar: me.avatarUrl() } });

      // nobody answered: a missed call, shown in their chat (and only there)
      call.timer = setTimeout(async () => {
        if (!calls.get(call.id) || call.state !== 'ringing') return;
        finish(call, 'missed');
        try {
          await addMissedCall(io, me, other);
        } catch (err) {
          console.error('Could not write the missed call into the chat:', err.message);
        }
      }, calls.RING_SECONDS * 1000);

      reply({ ok: true, callId: call.id });
    } catch (err) {
      console.error('Call invite failed:', err.message);
      reply({ ok: false, reason: 'error' });
    }
  });

  // the person being called picks up: { callId }
  socket.on('call:accept', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const call = calls.get(data && data.callId);
    if (!call || call.calleeId !== myId || call.state !== 'ringing') return reply({ ok: false });
    clearTimeout(call.timer);
    call.state = 'active';
    call.acceptedAt = Date.now();
    call.calleeSocket = socket.id;
    // their other tabs and phones stop ringing
    socket.to(userRoom(myId)).emit('call:ended', { callId: call.id, reason: 'answered_elsewhere' });
    io.to(call.callerSocket).emit('call:accepted', { callId: call.id });
    reply({ ok: true });
  });

  // the person being called says no: { callId }
  socket.on('call:decline', (data) => {
    const call = calls.get(data && data.callId);
    if (!call || call.calleeId !== myId || call.state !== 'ringing') return;
    finish(call, 'declined');
  });

  // either person hangs up (or the caller gives up while it rings): { callId }
  socket.on('call:end', (data) => {
    const call = calls.get(data && data.callId);
    if (!call || (call.callerId !== myId && call.calleeId !== myId)) return;
    finish(call, call.state === 'ringing' ? 'cancelled' : 'hangup');
  });

  // set-up messages between the two phones (offer, answer, network addresses): { callId, data }
  socket.on('call:signal', (msg) => {
    const call = calls.get(msg && msg.callId);
    if (!call || call.state !== 'active') return;
    if (JSON.stringify(msg.data || '').length > MAX_SIGNAL_BYTES) return;
    const targetSocket = call.callerId === myId && call.callerSocket === socket.id ? call.calleeSocket
      : call.calleeId === myId && call.calleeSocket === socket.id ? call.callerSocket : null;
    if (targetSocket) io.to(targetSocket).emit('call:signal', { callId: call.id, data: msg.data });
  });

  // a phone dropped: end its call
  socket.on('disconnect', () => {
    const call = calls.forUser(myId);
    if (!call) return;
    const mine = call.callerSocket === socket.id || call.calleeSocket === socket.id;
    // ringing calls to someone's other tabs carry on; a call this connection was part of ends
    if (mine) finish(call, 'dropped', socket.id);
  });
}

module.exports = setupCalls;
