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

test('a watcher sees someone online, then offline when their last connection closes', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);

  expect(await sa.emitWithAck('presence:watch', [b.id])).toEqual({ [b.id]: 'offline' });

  const updates = [];
  sa.on('presence:update', (u) => updates.push(u));
  const sb1 = connect(await sessionFor(b));
  await whenConnected(sb1);
  await tick();
  expect(updates).toEqual([{ id: b.id, status: 'online' }]);

  // a second tab changes nothing; closing one tab leaves them online
  const sb2 = connect(await sessionFor(b));
  await whenConnected(sb2);
  sb1.close();
  await tick();
  expect(updates).toHaveLength(1);

  sb2.close();
  await tick();
  expect(updates[1]).toEqual({ id: b.id, status: 'offline' });
  expect(await sa.emitWithAck('presence:watch', [b.id])).toEqual({ [b.id]: 'offline' });
  sa.close();
});

test('someone who hides their status shows nothing, even while online', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved', showOnlineStatus: false });
  const sa = connect(await sessionFor(a));
  const sb = connect(await sessionFor(b));
  await whenConnected(sa);
  await whenConnected(sb);

  expect(await sa.emitWithAck('presence:watch', [b.id])).toEqual({});
  sa.close();
  sb.close();
});

test('blocked people cannot watch each other', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  await Block.create({ blockerId: a.id, blockedId: b.id });
  const sa = connect(await sessionFor(a));
  await whenConnected(sa);

  expect(await sa.emitWithAck('presence:watch', [b.id])).toEqual({});
  sa.close();
});
