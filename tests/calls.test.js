const http = require('http');
const request = require('supertest');
const { io: connectClient } = require('socket.io-client');
const app = require('../src/app');
const setupSockets = require('../src/sockets');
const { Block } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, signIn } = require('./helpers');

let server;
let io;
let baseUrl;

beforeAll((done) => {
  server = http.createServer(app);
  io = setupSockets(server);
  app.set('io', io);
  server.listen(0, () => {
    baseUrl = 'http://localhost:' + server.address().port;
    done();
  });
});
beforeEach(resetDb);
afterAll(async () => {
  io.close();
  await sequelize.close();
});

// logs in and returns the session cookie + a csrf token for that session
async function sessionFor(user) {
  const agent = request.agent(server);
  const loginPage = await agent.get('/login');
  const firstCookie = loginPage.headers['set-cookie'][0].split(';')[0];
  await signIn(agent, user.phone);
  const page = await agent.get('/events');
  return { cookie: firstCookie, csrf: csrfFrom(page.text) };
}

function connect(session) {
  return connectClient(baseUrl, {
    auth: { csrf: session.csrf },
    extraHeaders: { cookie: session.cookie },
    transports: ['websocket'],
    reconnection: false
  });
}

function whenConnected(socket) {
  return new Promise((resolve) => {
    if (socket.connected) return resolve(true); // may have connected already
    socket.on('connect', () => resolve(true));
    socket.on('connect_error', () => resolve(false));
  });
}

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
// waits (up to 5 seconds) for something that happens a moment after the event it follows
async function waitFor(check) {
  for (let i = 0; i < 50 && !(await check()); i++) await tick(100);
}
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

async function twoSeniors() {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  const sb = connect(await sessionFor(b));
  await whenConnected(sa);
  await whenConnected(sb);
  return { a, b, sa, sb };
}

test('a call rings the other person, and they can answer and exchange set-up messages', async () => {
  const { a, b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  const reply = await sa.emitWithAck('call:invite', { toId: b.id });
  expect(reply.ok).toBe(true);
  const incoming = await ringing;
  expect(incoming.from).toEqual({ id: a.id, name: a.firstName(), avatar: a.avatarUrl() });

  const accepted = once(sa, 'call:accepted');
  expect((await sb.emitWithAck('call:accept', { callId: incoming.callId })).ok).toBe(true);
  await accepted;

  const offer = once(sb, 'call:signal');
  sa.emit('call:signal', { callId: incoming.callId, data: { sdp: { type: 'offer', sdp: 'x' } } });
  expect((await offer).data.sdp.type).toBe('offer');
  const answer = once(sa, 'call:signal');
  sb.emit('call:signal', { callId: incoming.callId, data: { sdp: { type: 'answer', sdp: 'y' } } });
  expect((await answer).data.sdp.type).toBe('answer');

  const ended = once(sb, 'call:ended');
  sa.emit('call:end', { callId: incoming.callId });
  expect((await ended).reason).toBe('hangup');
  sa.close();
  sb.close();
});

test('declining tells the caller, and frees both people for another call', async () => {
  const { b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  await sa.emitWithAck('call:invite', { toId: b.id });
  const { callId } = await ringing;
  const ended = once(sa, 'call:ended');
  sb.emit('call:decline', { callId });
  expect((await ended).reason).toBe('declined');
  expect((await sa.emitWithAck('call:invite', { toId: b.id })).ok).toBe(true);
  sa.close();
  sb.close();
});

test('no call to someone offline, blocked, or already on a call', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const off = await makeUser({ verificationStatus: 'approved' });
  const blocked = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  const sBlocked = connect(await sessionFor(blocked));
  await whenConnected(sa);
  await whenConnected(sBlocked);
  await Block.create({ blockerId: blocked.id, blockedId: a.id });

  expect(await sa.emitWithAck('call:invite', { toId: off.id })).toMatchObject({ ok: false, reason: 'offline' });
  expect(await sa.emitWithAck('call:invite', { toId: blocked.id })).toEqual({ ok: false, reason: 'unavailable' });

  const c = await makeUser({ verificationStatus: 'approved' });
  const sc = connect(await sessionFor(c));
  await whenConnected(sc);
  expect((await sa.emitWithAck('call:invite', { toId: c.id })).ok).toBe(true);
  const d = await makeUser({ verificationStatus: 'approved' });
  const sd = connect(await sessionFor(d));
  await whenConnected(sd);
  expect(await sd.emitWithAck('call:invite', { toId: c.id })).toEqual({ ok: false, reason: 'busy' });
  [sa, sBlocked, sc, sd].forEach((s) => s.close());
});

test('hanging up while it rings cancels, and a dropped phone ends the call', async () => {
  const { b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  const { callId } = await sa.emitWithAck('call:invite', { toId: b.id });
  await ringing;
  const cancelled = once(sb, 'call:ended');
  sa.emit('call:end', { callId });
  expect((await cancelled).reason).toBe('cancelled');

  const ringing2 = once(sb, 'call:incoming');
  const second = await sa.emitWithAck('call:invite', { toId: b.id });
  await ringing2;
  await sb.emitWithAck('call:accept', { callId: second.callId });
  const dropped = once(sa, 'call:ended');
  sb.close();
  expect((await dropped).reason).toBe('dropped');
  sa.close();
});

test('a call that rings out is a line in the chat for both people, and nowhere else', async () => {
  const calls = require('../src/services/calls');
  const { Message, Notification } = require('../src/models');
  const original = calls.RING_SECONDS;
  calls.RING_SECONDS = 0.3; // rings for a third of a second here instead of 30
  try {
    const { a, b, sa, sb } = await twoSeniors();
    const ringing = once(sb, 'call:incoming');
    await sa.emitWithAck('call:invite', { toId: b.id });
    await ringing;
    const ended = once(sa, 'call:ended');
    expect((await ended).reason).toBe('missed');
    await tick(300);

    // one line in the chat, from the caller, unread for the person called
    const lines = await Message.findAll({ where: { kind: 'missed_call' } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ senderId: a.id, recipientId: b.id, readAt: null });

    // no call notification for either person, so nothing on the Notifications page or the Account badge
    expect(await Notification.count({ where: { type: ['call.missed', 'call.unanswered'] } })).toBe(0);
    const agentB = request.agent(server);
    await signIn(agentB, b.phone);
    const notifications = await agentB.get('/notifications');
    expect(notifications.text).not.toMatch(/Missed call/);

    // the person called sees it in Messages (list and unread badge), then in the chat
    const list = await agentB.get('/messages');
    expect(list.text).toContain('Missed call');
    const thread = await agentB.get('/messages/' + a.id);
    expect(thread.text).toContain('Missed call');
    expect((await Message.findOne({ where: { kind: 'missed_call' } })).readAt).not.toBeNull(); // opening the chat read it

    // the caller sees that it was not answered
    const agentA = request.agent(server);
    await signIn(agentA, a.phone);
    const callerThread = await agentA.get('/messages/' + b.id);
    expect(callerThread.text).toContain('did not answer');
    expect((await agentA.get('/messages')).text).toContain('Call not answered');
    sa.close();
    sb.close();
  } finally {
    calls.RING_SECONDS = original;
  }
});

test('a declined or cancelled call does not write anything into the chat', async () => {
  const { Message } = require('../src/models');
  const { b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  const { callId } = await sa.emitWithAck('call:invite', { toId: b.id });
  await ringing;
  sa.emit('call:end', { callId });
  await tick(300);
  expect(await Message.count({ where: { kind: 'missed_call' } })).toBe(0);
  sa.close();
  sb.close();
});

test('an answered call is written into the chat with who called and how long it lasted', async () => {
  const { Message, Notification } = require('../src/models');
  const { a, b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  await sa.emitWithAck('call:invite', { toId: b.id });
  const incoming = await ringing;
  const accepted = once(sa, 'call:accepted');
  await sb.emitWithAck('call:accept', { callId: incoming.callId });
  await accepted;
  await tick(1200); // they talk for a moment
  const ended = once(sb, 'call:ended');
  sa.emit('call:end', { callId: incoming.callId });
  expect((await ended).reason).toBe('hangup');
  await waitFor(async () => (await Message.count({ where: { kind: 'call' } })) > 0);

  // one line, from the caller, already read: a finished call is not news
  const lines = await Message.findAll({ where: { kind: 'call' } });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ senderId: a.id, recipientId: b.id });
  expect(lines[0].readAt).not.toBeNull();
  expect(Number(lines[0].body)).toBeGreaterThanOrEqual(1);
  expect(Number(lines[0].body)).toBeLessThanOrEqual(5);
  expect(await Message.count({ where: { kind: 'missed_call' } })).toBe(0);
  expect(await Notification.count({ where: { userId: b.id, type: 'message.new' } })).toBe(0);

  // both people see it, worded from their side
  const agentB = request.agent(server);
  await signIn(agentB, b.phone);
  const calleeSees = await agentB.get('/messages/' + a.id);
  expect(calleeSees.text).toContain(a.firstName() + ' called');
  expect(calleeSees.text).toMatch(/\d+ sec/);
  expect((await agentB.get('/messages')).text).toContain('Call, ');
  const agentA = request.agent(server);
  await signIn(agentA, a.phone);
  const callerSees = await agentA.get('/messages/' + b.id);
  expect(callerSees.text).toContain('You called');
  expect(callerSees.text).toMatch(/\d+ sec/);
  sa.close();
  sb.close();
});

test('a call that is dropped part-way is still recorded, and one that was never answered is not', async () => {
  const { Message } = require('../src/models');
  const { b, sa, sb } = await twoSeniors();
  const ringing = once(sb, 'call:incoming');
  await sa.emitWithAck('call:invite', { toId: b.id });
  const incoming = await ringing;
  await sb.emitWithAck('call:accept', { callId: incoming.callId });
  await tick(300);
  sa.close(); // the caller's phone loses signal
  await waitFor(async () => (await Message.count({ where: { kind: 'call' } })) > 0);
  expect(await Message.count({ where: { kind: 'call' } })).toBe(1);
  sb.close();
});

test('long calls read naturally: seconds, minutes and hours', async () => {
  const { Message } = require('../src/models');
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  for (const [seconds, expected] of [[0, '0 sec'], [45, '45 sec'], [60, '1 min 0 sec'], [754, '12 min 34 sec'], [3725, '1 hr 2 min']]) {
    await Message.destroy({ where: {} });
    await Message.create({ senderId: a.id, recipientId: b.id, body: String(seconds), kind: 'call', readAt: new Date() });
    const agent = request.agent(server);
    await signIn(agent, b.phone);
    expect([seconds, (await agent.get('/messages/' + a.id)).text.includes(expected)]).toEqual([seconds, true]);
  }
});

test('calling someone who is offline leaves a missed call in their chat for every try, and hands the line back to the caller', async () => {
  const { Message, Notification } = require('../src/models');
  const a = await makeUser({ verificationStatus: 'approved' });
  const away = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);

  const first = await sa.emitWithAck('call:invite', { toId: away.id });
  expect(first).toMatchObject({ ok: false, reason: 'offline' });
  expect(first.line).toMatchObject({ senderId: a.id, kind: 'missed_call' }); // the page shows this at once
  await sa.emitWithAck('call:invite', { toId: away.id }); // and again, and again
  await sa.emitWithAck('call:invite', { toId: away.id });
  const lines = await Message.findAll({ where: { kind: 'missed_call' }, order: [['id', 'ASC']] });
  expect(lines).toHaveLength(3); // one line for every try
  expect(first.line.id).toBe(lines[0].id);
  expect(lines[0]).toMatchObject({ senderId: a.id, recipientId: away.id, readAt: null });
  expect((await require('../src/services/social').unreadSenderIds(away.id)).size).toBe(1); // the Messages badge counts people, not tries

  // when they come back: it is in the chat for them, and for the caller as "did not answer"
  const back = request.agent(server);
  await signIn(back, away.phone);
  expect((await back.get('/messages')).text).toContain('Missed call');
  expect((await back.get('/messages/' + a.id)).text).toContain('Missed call');
  const caller = request.agent(server);
  await signIn(caller, a.phone);
  expect((await caller.get('/messages/' + away.id)).text).toContain('did not answer');
  sa.close();
});

test('a blocked person gets no missed call line, and the offline attempts count toward the call limit', async () => {
  const { Message } = require('../src/models');
  const a = await makeUser({ verificationStatus: 'approved' });
  const blocker = await makeUser({ verificationStatus: 'approved' });
  await Block.create({ blockerId: blocker.id, blockedId: a.id });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);
  expect((await sa.emitWithAck('call:invite', { toId: blocker.id })).reason).toBe('unavailable');
  expect(await Message.count({ where: { kind: 'missed_call' } })).toBe(0);

  const away = await makeUser({ verificationStatus: 'approved' });
  await waitFor(async () => !require('../src/services/calls').isBusy(a.id)); // an earlier test's call may still be winding down
  let reason;
  for (let i = 0; i < 12; i++) reason = (await sa.emitWithAck('call:invite', { toId: away.id })).reason;
  expect(reason).toBe('too_many'); // after 10 tries in 10 minutes
  expect(await Message.count({ where: { kind: 'missed_call' } })).toBe(10); // the ten that were allowed, no more
  sa.close();
});
