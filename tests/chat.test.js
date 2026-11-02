const request = require('supertest');
const app = require('../src/app');
const { Message, Notification } = require('../src/models');
const exchange = require('../src/services/phoneExchange');
const social = require('../src/services/social');
const { resetDb, makeUser, sequelize, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function setup() {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  await Message.create({ senderId: b.id, recipientId: a.id, body: 'Hello there' });
  const agent = request.agent(app);
  await signIn(agent, a.phone);
  return { a, b, agent };
}

test('the chat keeps the top, the box to write in, Report and Block in view; only the messages scroll', async () => {
  const { b, agent } = await setup();
  const page = (await agent.get('/messages/' + b.id)).text;
  expect(page).toContain('id="thread-scroll"');
  expect(page).toContain('data-chat-form');
  expect(page).toContain('href="/report/' + b.id + '"');
  expect(page).toContain('href="/block/' + b.id + '"');
  expect(page).toContain('Hello there');
  // messages are words only: no attachments or voice notes
  expect(page).not.toContain('type="file"');
  expect(page).not.toContain('data-voice');
});

test('the list of people has a search box and shows the last message', async () => {
  const { agent } = await setup();
  const inbox = (await agent.get('/messages')).text;
  expect(inbox).toContain('data-chat-search');
  expect(inbox).toContain('Hello there');
});

test('new messages badge Messages, not Account, and opening the chat clears it', async () => {
  const { a, b, agent } = await setup();
  await Notification.create({ userId: a.id, type: 'message.new', payload: { senderId: b.id, name: 'B' }, link: '/messages/' + b.id });

  const before = (await agent.get('/events')).text;
  expect(before).toMatch(/href="\/messages"[\s\S]{0,400}rounded-full bg-indigo/);
  expect(before).not.toMatch(/href="\/account"[\s\S]{0,400}rounded-full bg-indigo/);
  expect((await agent.get('/notifications')).text).not.toContain('New message from');

  await agent.get('/messages/' + b.id);
  expect(await Notification.count({ where: { userId: a.id, type: 'message.new', readAt: null } })).toBe(0);
});

test('the Call button is always there, and Swap phone numbers is a visible button until the swap is done', async () => {
  const { a, b, agent } = await setup();
  const before = (await agent.get('/messages/' + b.id)).text;
  expect(before).toContain('data-call-to="' + b.id + '"');
  expect(before).toContain('data-online="false"'); // greyed out: they are not online
  expect(before).toContain('Swap phone numbers');
  expect(before).not.toContain('icon-ellipsis-vertical'); // not hidden in a menu

  await exchange.request(a, b);
  const waiting = (await agent.get('/messages/' + b.id)).text;
  expect(waiting).not.toContain('Swap phone numbers');

  await exchange.respond(b, a, true);
  const done = (await agent.get('/messages/' + b.id)).text;
  expect(done).not.toContain('Swap phone numbers');
  expect(done).toContain('tel:' + b.localPhone());
});

test('Find seniors no longer shows someone you have a conversation with', async () => {
  const { a, b } = await setup(); // b has written to a
  const c = await makeUser({ verificationStatus: 'approved' });
  expect(await social.hiddenIdsFor(a.id)).toContain(b.id);
  expect(await social.hiddenIdsFor(a.id)).not.toContain(c.id);
  expect((await social.nextSeniorFor(a)).id).toBe(c.id);
  // the same from the other side: the person who wrote first doesn't see them again either
  await Message.create({ senderId: a.id, recipientId: c.id, body: 'Hi' });
  expect(await social.hiddenIdsFor(c.id)).toContain(a.id);
});

test('a profile page shows the picture slot and the whole introduction, and the chat header links to it', async () => {
  const { b, agent } = await setup();
  await b.update({ bio: 'A long introduction that should be shown in full, to the very last word.' });
  const profile = await agent.get('/seniors/' + b.id);
  expect(profile.status).toBe(200);
  expect(profile.text).toContain('to the very last word.');
  const chat = (await agent.get('/messages/' + b.id)).text;
  expect(chat).toContain('href="/seniors/' + b.id + '"');
});

test('a profile is not shown to someone who cannot message that person', async () => {
  const { a, b, agent } = await setup();
  const { Block } = require('../src/models');
  await Block.create({ blockerId: b.id, blockedId: a.id });
  expect((await agent.get('/seniors/' + b.id)).status).toBe(403);
});
