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

  expect(await sa.emitWithAck('call:invite', { toId: off.id })).toEqual({ ok: false, reason: 'offline' });
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
