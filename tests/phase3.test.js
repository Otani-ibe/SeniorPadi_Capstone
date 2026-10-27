const http = require('http');
const request = require('supertest');
const { io: connectClient } = require('socket.io-client');
const app = require('../src/app');
const setupSockets = require('../src/sockets');
const { Message, Block, Registration } = require('../src/models');
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

test('socket refuses seniors who are not verified', async () => {
  const user = await makeUser();
  const socket = connect(await sessionFor(user));
  expect(await whenConnected(socket)).toBe(false);
  socket.close();
});

test('socket refuses a wrong csrf token', async () => {
  const user = await makeUser({ verificationStatus: 'approved' });
  const session = await sessionFor(user);
  const socket = connect({ ...session, csrf: 'wrong' });
  expect(await whenConnected(socket)).toBe(false);
  socket.close();
});

test('live message is saved and reaches the other senior', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  const sb = connect(await sessionFor(b));
  await whenConnected(sa);
  await whenConnected(sb);

  expect((await sa.emitWithAck('chat:join', { withId: b.id })).ok).toBe(true);
  expect((await sb.emitWithAck('chat:join', { withId: a.id })).ok).toBe(true);

  const received = new Promise((resolve) => sb.on('message:new', resolve));
  const reply = await sa.emitWithAck('message:send', { recipientId: b.id, body: 'Hello from the socket' });

  expect(reply.ok).toBe(true);
  expect((await received).body).toBe('Hello from the socket');
  expect(await Message.count()).toBe(1);
  sa.close();
  sb.close();
});

test('socket checks blocks on every message', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);

  await Block.create({ blockerId: b.id, blockedId: a.id }); // blocked after connecting
  const reply = await sa.emitWithAck('message:send', { recipientId: b.id, body: 'hi' });

  expect(reply.ok).toBe(false);
  expect(await Message.count()).toBe(0);
  sa.close();
});

test('socket stops a senior removed from the social layer after connecting', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);

  await a.update({ verificationStatus: 'social_removed' });
  const reply = await sa.emitWithAck('message:send', { recipientId: b.id, body: 'hi' });

  expect(reply.ok).toBe(false);
  expect(await Message.count()).toBe(0);
  sa.close();
});

test('QR check-in and the manual list update the same attendance record', async () => {
  const admin = await makeUser({ role: 'admin' });
  const senior = await makeUser();
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });

  const { cookie } = await sessionFor(admin);
  const scanPage = await request(server).get('/admin/scan/' + reg.qrToken).set('Cookie', cookie);
  await request(server).post('/admin/scan/' + reg.qrToken).set('Cookie', cookie).type('form')
    .send({ _csrf: csrfFrom(scanPage.text) });

  await reg.reload();
  expect(reg.status).toBe('attended');

  // the manual list shows the same record as attended
  const list = await request(server).get('/admin/events/' + event.id + '/attendance').set('Cookie', cookie);
  expect(list.text).toMatch(new RegExp('data-row="' + reg.id + '" data-status="attended"'));
  expect(list.text).toContain('by QR code');
});

test('a senior without the QR code can still be marked from the list', async () => {
  const admin = await makeUser({ role: 'admin' });
  const senior = await makeUser();
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });

  const { cookie } = await sessionFor(admin);
  const page = await request(server).get('/admin/events/' + event.id + '/attendance').set('Cookie', cookie);
  await request(server).post('/admin/events/' + event.id + '/attendance').set('Cookie', cookie).type('form')
    .send({ _csrf: csrfFrom(page.text), ['status_' + reg.id]: 'attended' });

  expect((await reg.reload()).status).toBe('attended');
});

test('there is no welcome video any more: signing in goes straight in, and old links go to Find events', async () => {
  const senior = await makeUser();
  const res = await signIn(request.agent(server), senior.phone);
  expect(res.headers.location).toBe('/');
  expect((await request(server).get('/onboarding')).headers.location).toBe('/events');
});
