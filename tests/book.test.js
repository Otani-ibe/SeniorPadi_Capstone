const request = require('supertest');
const app = require('../src/app');
const { Registration, VerificationCode } = require('../src/models');
const { lastCodeForTests } = require('../src/services/verification');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000) });

// a son or daughter starts booking, and the parent reads out the code
async function startBooking(agent, parent, eventId) {
  const page = await agent.get('/book-for-parent' + (eventId ? '?event=' + eventId : ''));
  await agent.post('/book-for-parent').type('form').send({
    _csrf: csrfFrom(page.text), childName: 'Tunde', parentPhone: parent.localPhone(), event: eventId ? String(eventId) : ''
  });
  const code = await agent.get('/book-for-parent/code');
  return agent.post('/book-for-parent/code').type('form').send({ _csrf: csrfFrom(code.text), code: lastCodeForTests(parent.id) });
}

test('visitors see "Booking for your mum or dad?" on an event and in the Find events deck', async () => {
  const event = await makeEvent({ ...later(3) });
  expect((await request(app).get('/events/' + event.id)).text).toContain('/book-for-parent?event=' + event.id);
  expect((await request(app).get('/events')).text).toContain('/book-for-parent?event=' + event.id);
});

test('a signed-in senior does not see the link', async () => {
  const me = await makeUser({ onboardingSeenAt: new Date() });
  const event = await makeEvent({ ...later(3) });
  const agent = request.agent(app);
  await signIn(agent, me.phone);
  expect((await agent.get('/events/' + event.id)).text).not.toContain('/book-for-parent?event=');
});

test('the code goes to the parent; once read out, the parent is booked for the event and gets the ticket', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const agent = request.agent(app);

  const page = await agent.get('/book-for-parent?event=' + event.id);
  expect(page.text).toContain('Painting class');
  const sent = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', parentPhone: parent.localPhone(), event: String(event.id) });
  expect(sent.headers.location).toBe('/book-for-parent/code');
  expect(await VerificationCode.count({ where: { userId: parent.id } })).toBe(1);

  const codePage = await agent.get('/book-for-parent/code');
  expect(codePage.text).toContain('A code has been sent to Mama Tolu');
  const res = await agent.post('/book-for-parent/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(parent.id) });
  expect(res.headers.location).toBe('/events');
  const done = await agent.get('/events');
  expect(done.text).toContain('Mama Tolu is registered!');          // the registered pop-up

  const reg = await Registration.findOne({ where: { seniorId: parent.id, eventId: event.id } });
  expect(reg).not.toBeNull();
  expect(done.text).toContain(reg.ticketNumber);
  expect((await agent.get('/events')).text).not.toContain('is registered!'); // shown once
  expect((await agent.get('/account')).headers.location).toBe('/login'); // the child is never signed in as the parent
});

test('while booking, every event shows "Book for Mama Tolu" and a banner with Finish; Finish ends it', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const first = await makeEvent({ title: 'Painting class', ...later(3) });
  const second = await makeEvent({ title: 'Morning walk', ...later(5) });
  const agent = request.agent(app);
  await startBooking(agent, parent, first.id);

  let page = await agent.get('/events/' + second.id);
  expect(page.text).toContain('You are booking for Mama Tolu');
  expect(page.text).toContain('Register for Mama Tolu');
  expect(page.text).toMatch(/action="\/book-for-parent\/\d+\/register" method="post" data-deck-register/); // the deck can send it
  const booked = await agent.post('/book-for-parent/' + second.id + '/register').type('form').send({ _csrf: csrfFrom(page.text), back: '/events/' + second.id });
  expect(booked.headers.location).toBe('/events/' + second.id);   // back to the same page
  expect((await agent.get('/events/' + second.id)).text).toContain('Mama Tolu is registered!');
  expect(await Registration.count({ where: { seniorId: parent.id } })).toBe(2);

  page = await agent.get('/events');
  await agent.post('/book-for-parent/finish').type('form').send({ _csrf: csrfFrom(page.text) });
  page = await agent.get('/events/' + second.id);
  expect(page.text).not.toContain('You are booking for');
  const after = await agent.post('/book-for-parent/' + first.id + '/register').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(after.headers.location).toContain('/book-for-parent?event=');      // no booking without a new code
});

test('starting without an event: after the code, the child picks one', async () => {
  const parent = await makeUser({ fullName: 'Baba Kunle' });
  const agent = request.agent(app);
  const res = await startBooking(agent, parent, null);
  expect(res.headers.location).toBe('/events');
  expect((await agent.get('/events')).text).toContain('You are booking for Baba Kunle');
});

test('a wrong code books nothing', async () => {
  const parent = await makeUser();
  const event = await makeEvent({ ...later(3) });
  const agent = request.agent(app);
  const page = await agent.get('/book-for-parent?event=' + event.id);
  await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', parentPhone: parent.localPhone(), event: String(event.id) });
  const code = await agent.get('/book-for-parent/code');
  const res = await agent.post('/book-for-parent/code').type('form').send({ _csrf: csrfFrom(code.text), code: '000000' });
  expect(res.headers.location).toBe('/book-for-parent/code');
  expect(await Registration.count()).toBe(0);
});

test('a number with no account is told to sign the parent up first', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/book-for-parent');
  const res = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', parentPhone: '0805 999 0000' });
  expect(res.status).toBe(400);
  expect(res.text).toContain('no SeniorPadi account yet');
  expect(res.text).toContain('/signup/parent');
});

test('the parent\'s code text says who is asking', () => {
  const sms = t('parent.book_code.sms', 'en', { child: 'Tunde', code: '123456', minutes: 10 });
  expect(sms).toContain('Tunde wants to book events for you');
  expect(sms).toContain('Only read it to Tunde if you agree');
});

test('right after signing a parent up, the child can book for them straight away, with no new code', async () => {
  const { User } = require('../src/models');
  const agent = request.agent(app);
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const form = await agent.get('/signup/parent');
  await agent.post('/signup/parent').type('form').send({
    _csrf: csrfFrom(form.text), childName: 'Tunde', childPhone: '0805 111 2222',
    parentName: 'Mrs Esther Bello', parentPhone: '0805 333 4444', ageDeclared: 'yes'
  });
  const parent = await User.findOne({ where: { fullName: 'Mrs Esther Bello' } });
  const codePage = await agent.get('/signup/parent/code');
  const done = await agent.post('/signup/parent/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(parent.id) });
  expect(done.text).toContain('For the next 24 hours you can book events for Mrs Esther');

  const codesBefore = await VerificationCode.count();
  const page = await agent.get('/events/' + event.id);
  expect(page.text).toContain('Register for Mrs Esther');
  await agent.post('/book-for-parent/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(page.text), back: '/events' });
  expect((await agent.get('/events')).text).toContain('Mrs Esther is registered!');
  expect(await VerificationCode.count()).toBe(codesBefore); // the parent was not asked for another code
});

test('booking for a parent lasts one day; signing in lasts 30 days', () => {
  const { bookingActive, signInExpired } = require('../src/services/sessionTimes');
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  expect(bookingActive({ at: now - 23 * HOUR }, now)).toBe(true);
  expect(bookingActive({ at: now - 25 * HOUR }, now)).toBe(false);
  expect(signInExpired(now - 29 * 24 * HOUR, now)).toBe(false);
  expect(signInExpired(now - 31 * 24 * HOUR, now)).toBe(true);
});
