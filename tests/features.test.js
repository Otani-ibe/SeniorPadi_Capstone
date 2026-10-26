const request = require('supertest');
const app = require('../src/app');
const { Registration, Attendance, User, Translation } = require('../src/models');
const { sendCode } = require('../src/services/verification');
const { translateTexts } = require('../src/services/translate');
const { sendReminders } = require('../src/services/cron');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  await signIn(agent, phone);
  return agent;
}
async function post(agent, url, data) {
  const page = await agent.get('/events');
  return agent.post(url).type('form').send(Object.assign({ _csrf: csrfFrom(page.text) }, data || {}));
}

// ---------- tickets ----------
test('registering gives a unique ticket number that is shown on the pop-up', async () => {
  const user = await makeUser();
  const event = await makeEvent();
  const agent = await loggedInAgent(user.phone);

  await post(agent, '/events/' + event.id + '/register');
  const reg = await Registration.findOne({ where: { seniorId: user.id } });
  expect(reg.ticketNumber).toMatch(/^SP-[A-Z2-9]{6}$/);

  const popup = await agent.get('/events/' + event.id + '/registered');
  expect(popup.text).toContain(reg.ticketNumber);
});

// ---------- phone and email verification ----------
test('an unconfirmed phone has to be confirmed before joining an event', async () => {
  const user = await makeUser();
  const event = await makeEvent();
  const agent = await loggedInAgent(user.phone);
  await user.update({ phoneVerifiedAt: null }); // e.g. an older account whose phone was never confirmed

  const res = await post(agent, '/events/' + event.id + '/register');
  expect(res.headers.location).toBe('/verify');
  expect(await Registration.count()).toBe(0);

  // they get a code by SMS and type it in: then they're registered straight away
  const { code } = await sendCode(user, 'phone');
  const verifyPage = await agent.get('/verify?sent=phone');
  const done = await agent.post('/verify/check').type('form').send({ _csrf: csrfFrom(verifyPage.text), channel: 'phone', code });
  expect(done.headers.location).toBe('/events/' + event.id + '/registered');
  expect(await Registration.count({ where: { seniorId: user.id } })).toBe(1);
});

test('a wrong code is refused', async () => {
  const user = await makeUser();
  const agent = await loggedInAgent(user.phone);
  await user.update({ phoneVerifiedAt: null });
  await sendCode(user, 'phone');
  const page = await agent.get('/verify?sent=phone');
  await agent.post('/verify/check').type('form').send({ _csrf: csrfFrom(page.text), channel: 'phone', code: '000000' });
  await user.reload();
  expect(user.phoneVerifiedAt).toBeNull();
});

test('if they gave an email, it must be confirmed too', async () => {
  const user = await makeUser({ email: 'mama@example.com' });
  expect(user.contactVerified()).toBe(false);
  await user.update({ emailVerifiedAt: new Date() });
  expect(user.contactVerified()).toBe(true);
});

test('messaging needs a confirmed phone', async () => {
  const me = await makeUser({ verificationStatus: 'approved' });
  const other = await makeUser({ verificationStatus: 'approved' });
  const agent = await loggedInAgent(me.phone);
  await me.update({ phoneVerifiedAt: null });
  const res = await agent.get('/messages/' + other.id);
  expect(res.headers.location).toBe('/verify');
});

// ---------- swapping phone numbers ----------
test('a number is only shown after the other senior accepts', async () => {
  const a = await makeUser({ verificationStatus: 'approved', fullName: 'Ade Test' });
  const b = await makeUser({ verificationStatus: 'approved', fullName: 'Bisi Test' });
  const agentA = await loggedInAgent(a.phone);
  const agentB = await loggedInAgent(b.phone);
  const bLocal = '0' + b.phone.replace('+234', '');

  await post(agentA, '/messages/' + b.id + '/exchange');
  let pageA = await agentA.get('/messages/' + b.id);
  expect(pageA.text).not.toContain(bLocal);

  const pageB = await agentB.get('/messages/' + a.id);
  expect(pageB.text).toMatch(/exchange\/accept/); // the pop-up

  await post(agentB, '/messages/' + a.id + '/exchange/accept');
  pageA = await agentA.get('/messages/' + b.id);
  expect(pageA.text).toContain(bLocal);
});

test('declining keeps the number hidden', async () => {
  const a = await makeUser({ verificationStatus: 'approved' });
  const b = await makeUser({ verificationStatus: 'approved' });
  const agentA = await loggedInAgent(a.phone);
  const agentB = await loggedInAgent(b.phone);
  await post(agentA, '/messages/' + b.id + '/exchange');
  await post(agentB, '/messages/' + a.id + '/exchange/decline');
  const pageA = await agentA.get('/messages/' + b.id);
  expect(pageA.text).not.toContain('0' + b.phone.replace('+234', ''));
});

// ---------- attendance ----------
test('checking in by ticket number creates an attendance record', async () => {
  const admin = await makeUser({ role: 'admin' });
  const senior = await makeUser();
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });
  const agent = await loggedInAgent(admin.phone);

  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/checkin').type('form').send({ _csrf: csrfFrom(page.text), ticket: reg.ticketNumber.toLowerCase() });

  const row = await Attendance.findOne({ where: { registrationId: reg.id } });
  expect(row.method).toBe('ticket');
  expect((await reg.reload()).status).toBe('attended');
});

test('unticking someone removes their attendance record', async () => {
  const admin = await makeUser({ role: 'admin' });
  const senior = await makeUser();
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });
  const agent = await loggedInAgent(admin.phone);

  let page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/attendance').type('form').send({ _csrf: csrfFrom(page.text), ['status_' + reg.id]: 'attended' });
  expect(await Attendance.count()).toBe(1);

  page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/attendance').type('form').send({ _csrf: csrfFrom(page.text), ['status_' + reg.id]: 'no_show' });
  expect(await Attendance.count()).toBe(0);
});

test('the dashboard shows events, registrations and attendees', async () => {
  const admin = await makeUser({ role: 'admin' });
  const event = await makeEvent();
  const s1 = await makeUser();
  const s2 = await makeUser();
  const r1 = await Registration.create({ eventId: event.id, seniorId: s1.id, type: 'attendee', status: 'attended' });
  await Registration.create({ eventId: event.id, seniorId: s2.id, type: 'attendee' });
  await Attendance.create({ eventId: event.id, registrationId: r1.id, seniorId: s1.id, method: 'manual' });

  const agent = await loggedInAgent(admin.phone);
  const page = await agent.get('/admin');
  const stat = (key) => Number(page.text.match(new RegExp('data-stat="' + key + '">(\\d+)<'))[1]);
  expect([stat('events'), stat('registrations'), stat('attendees')]).toEqual([1, 2, 1]);

  // the live numbers the page refreshes itself with
  const json = await agent.get('/admin/stats.json');
  expect(json.body.totals.attendees).toBe(1);
  expect(json.body.days).toHaveLength(14);
});

// ---------- events for visitors, category filter, about page ----------
test('visitors can see events and get the sign-up pop-up when they register', async () => {
  const event = await makeEvent({ title: 'Open to everyone' });
  const page = await request(app).get('/events?login=' + event.id);
  expect(page.text).toContain('Open to everyone');
  expect(page.text).toContain('Sign up to register');
});

test('events can be filtered by category', async () => {
  await makeEvent({ title: 'Walking club', category: 'fitness' });
  await makeEvent({ title: 'Bible study', category: 'faith' });
  const page = await request(app).get('/events?category=faith');
  expect(page.text).toContain('Bible study');
  expect(page.text).not.toContain('Walking club');
});

test('the About page works', async () => {
  const page = await request(app).get('/about');
  expect(page.status).toBe(200);
});

// ---------- reminders ----------
test('reminders are only sent to seniors who switched them on', async () => {
  const event = await makeEvent({ startsAt: new Date(Date.now() + 2 * DAY), endsAt: new Date(Date.now() + 2 * DAY + 3600000) });
  const on = await makeUser({ reminderDaysBefore: 2, remindersEnabled: true });
  const off = await makeUser({ reminderDaysBefore: 2, remindersEnabled: false });
  await Registration.create({ eventId: event.id, seniorId: on.id, type: 'attendee' });
  await Registration.create({ eventId: event.id, seniorId: off.id, type: 'attendee' });
  expect(await sendReminders()).toBe(1);
});

// ---------- Google Translate ----------
test('event text is translated once and then read from the database', async () => {
  const realFetch = global.fetch;
  process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key';
  let calls = 0;
  global.fetch = async (url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ data: { translations: body.q.map((q) => ({ translatedText: 'YO: ' + q })) } }) };
  };
  try {
    expect(await translateTexts(['Morning walk'], 'yo')).toEqual(['YO: Morning walk']);
    expect(await translateTexts(['Morning walk'], 'yo')).toEqual(['YO: Morning walk']);
    expect(calls).toBe(1);
    expect(await Translation.count()).toBe(1);

    // if Google is down, the English is shown instead of an error
    global.fetch = async () => ({ ok: false, status: 500 });
    expect(await translateTexts(['Something new'], 'yo')).toEqual(['Something new']);
  } finally {
    global.fetch = realFetch;
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
  }
});

// ---------- free or paid events ----------
test('a paid event shows its price to seniors, a free one says Free', async () => {
  await makeEvent({ title: 'Paid baking class', price: 2500 });
  await makeEvent({ title: 'Morning walk', startsAt: new Date(Date.now() + 4 * DAY), endsAt: new Date(Date.now() + 4 * DAY + 3600000) });
  const page = await request(app).get('/events?area=all');
  expect(page.text).toMatch(/₦2,500/);
  expect(page.text.match(/₦/g)).toHaveLength(2); // the sticker on the photo, and the price row shown on phones
  expect(page.text.match(/data-price="free"/g)).toHaveLength(1);
  expect(page.text.match(/data-price="paid"/g)).toHaveLength(1);
});

test('staff must give an amount when an event is paid', async () => {
  await makeEvent(); // creates an organization, which the form needs
  const admin = await makeUser({ role: 'admin' });
  const agent = await loggedInAgent(admin.phone);
  const form = await agent.get('/admin/events/new');
  // a photo-upload form, so the token goes in the address
  const res = await agent.post('/admin/events?_csrf=' + encodeURIComponent(csrfFrom(form.text))).type('form').send({ pricing: 'paid', price: '' });
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/Enter how much it costs/);
  expect(res.text).toMatch(/value="paid" class="[^"]*" checked/);
});
