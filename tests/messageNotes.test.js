// everything about a conversation (messages, missed calls, swap requests) is a notification in MESSAGES, not Account notifications, and opening it clears them
const request = require('supertest');
const app = require('../src/app');
const { Notification } = require('../src/models');
const social = require('../src/services/social');
const exchange = require('../src/services/phoneExchange');
const { sendMessage, addMissedCall } = require('../src/services/messaging');
const { resetDb, makeUser, signIn, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const senior = (name) => makeUser({ verificationStatus: 'approved', fullName: name });

async function agentFor(user) {
  const agent = request.agent(app);
  await signIn(agent, user.phone);
  return agent;
}

// the numbers on the "Messages" and "My account" tabs of the bottom menu
function badges(html) {
  const tab = (href) => {
    const start = html.indexOf('<a href="' + href + '"');
    if (start === -1) return 0;
    const block = html.slice(start, html.indexOf('</a>', start));
    const match = block.match(/bg-indigo[^>]*>(\d+)</);
    return match ? Number(match[1]) : 0;
  };
  return { messages: tab('/messages'), account: tab('/account') };
}

const shown = async (agent, url = '/events') => badges((await agent.get(url)).text);
const row = (html, name) => {
  const start = html.indexOf('data-chat-name="' + name.toLowerCase() + '"');
  return start === -1 ? '' : html.slice(start, html.indexOf('</li>', start));
};

test('a new message is counted under Messages and not under My account, and not listed in Notifications', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await sendMessage(null, bola, me, 'Hello there');
  const agent = await agentFor(me);

  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  const notifications = await agent.get('/notifications');
  expect(notifications.text).not.toContain('New message from');
  expect(notifications.text).not.toContain('Bola');
  const inbox = await agent.get('/messages');
  expect(row(inbox.text, 'Bola')).toContain('New'); // marked in the list
});

test('a request to swap numbers is a Messages notification, shown on that person\'s row', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await sendMessage(null, bola, me, 'Hi');
  await exchange.request(bola, me);
  const agent = await agentFor(me);

  expect(await shown(agent)).toEqual({ messages: 1, account: 0 }); // one person waiting, however many things
  const inbox = await agent.get('/messages');
  expect(row(inbox.text, 'Bola')).toContain('Wants to swap numbers');
  expect(row(inbox.text, 'Bola')).toContain('New');
  const notifications = await agent.get('/notifications');
  expect(notifications.text).not.toMatch(/wants to swap phone numbers/i);
  expect((await agent.get('/account')).text).not.toMatch(/wants to swap/i);
});

test('someone who only sent a swap request (no message yet) still appears in Messages', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await exchange.request(bola, me);
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  const inbox = await agent.get('/messages');
  expect(row(inbox.text, 'Bola')).toContain('Wants to swap numbers');
});

test('the answer to a swap request comes back as a Messages notification too', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await sendMessage(null, me, bola, 'Hi Bola');
  await exchange.request(me, bola);
  await exchange.respond(bola, me, true);
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  expect(row((await agent.get('/messages')).text, 'Bola')).toContain('Swapped numbers with you');

  const no = await senior('Chidi Okoro');
  await sendMessage(null, me, no, 'Hi Chidi');
  await exchange.request(me, no);
  await exchange.respond(no, me, false);
  expect(row((await agent.get('/messages')).text, 'Chidi')).toContain('Said no to swapping');
});

test('a missed call is a Messages notification, not an Account one', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await addMissedCall(null, bola, me);
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  expect(row((await agent.get('/messages')).text, 'Bola')).toContain('Missed call');
  expect((await agent.get('/notifications')).text).not.toMatch(/missed call/i);
});

test('older missed-call notices (from before) are kept out of Account too, and counted in Messages', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await social.addNotification(me.id, 'call.missed', { name: 'Bola' }, '/messages/' + bola.id);
  await sendMessage(null, bola, me, 'x');
  await Notification.destroy({ where: { type: 'message.new' } }); // only the old kind is left
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  expect((await agent.get('/notifications')).text).not.toMatch(/missed call/i);
});

test('several things from one person are one person on the badge, with the count in their row', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  for (const text of ['one', 'two', 'three']) await sendMessage(null, bola, me, text);
  const agent = await agentFor(me);
  expect((await shown(agent)).messages).toBe(1);
  expect(row((await agent.get('/messages')).text, 'Bola')).toContain('3 new');
});

test('opening a conversation takes its notifications away, and the count goes down one person at a time', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  const chidi = await senior('Chidi Okoro');
  await sendMessage(null, bola, me, 'Hi from Bola');
  await exchange.request(bola, me);
  await sendMessage(null, chidi, me, 'Hi from Chidi');
  await addMissedCall(null, chidi, me);
  const agent = await agentFor(me);

  expect((await shown(agent)).messages).toBe(2);
  await agent.get('/messages/' + bola.id); // read Bola's: the message and the swap request
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 });
  const inbox = await agent.get('/messages');
  expect(row(inbox.text, 'Bola')).not.toContain('Wants to swap numbers');
  expect(row(inbox.text, 'Bola')).not.toContain('data-chat-alerts');
  expect(row(inbox.text, 'Chidi')).toContain('2 new'); // a message and a missed call

  await agent.get('/messages/' + chidi.id);
  expect(await shown(agent)).toEqual({ messages: 0, account: 0 });
  expect(await Notification.count({ where: { userId: me.id, readAt: null } })).toBe(0);
});

test('reading the Account notifications does not read the Messages ones', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await sendMessage(null, bola, me, 'Hi');
  await social.addNotification(me.id, 'identity.verified', {}, '/find-seniors');
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 1, account: 1 });
  await agent.get('/notifications');
  expect(await shown(agent)).toEqual({ messages: 1, account: 0 }); // only the Account one was read
});

test('everything else still shows in Account and counts there, and not in Messages', async () => {
  const me = await senior('Kehinde Ade');
  await social.addNotification(me.id, 'identity.verified', {}, '/find-seniors');
  await social.addNotification(me.id, 'account.warned', {}, null);
  const agent = await agentFor(me);
  expect(await shown(agent)).toEqual({ messages: 0, account: 2 });
  expect((await agent.get('/notifications')).text).toContain('You are verified');
});

test('someone you blocked does not show up in your Messages notifications', async () => {
  const me = await senior('Kehinde Ade');
  const bola = await senior('Bola Tunde');
  await sendMessage(null, bola, me, 'Hi');
  const { Block } = require('../src/models');
  await Block.create({ blockerId: me.id, blockedId: bola.id });
  const agent = await agentFor(me);
  expect(row((await agent.get('/messages')).text, 'Bola')).toBe('');
});
