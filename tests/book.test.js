const request = require('supertest');
const app = require('../src/app');
const { Registration, VerificationCode } = require('../src/models');
const { lastCodeForTests } = require('../src/services/verification');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const CHILD_PHONE = '0809 999 0000'; // the son or daughter's own number
const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000) });

// a son or daughter starts booking, and the parent reads out the code
async function startBooking(agent, parent, eventId) {
  const page = await agent.get('/book-for-parent' + (eventId ? '?event=' + eventId : ''));
  await agent.post('/book-for-parent').type('form').send({
    _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: CHILD_PHONE, parentPhone: parent.localPhone(), event: eventId ? String(eventId) : ''
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
  const sent = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: CHILD_PHONE, parentPhone: parent.localPhone(), event: String(event.id) });
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
  await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: CHILD_PHONE, parentPhone: parent.localPhone(), event: String(event.id) });
  const code = await agent.get('/book-for-parent/code');
  const res = await agent.post('/book-for-parent/code').type('form').send({ _csrf: csrfFrom(code.text), code: '000000' });
  expect(res.headers.location).toBe('/book-for-parent/code');
  expect(await Registration.count()).toBe(0);
});

test('a number with no account is told to sign the parent up first', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/book-for-parent');
  const res = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: CHILD_PHONE, parentPhone: '0805 999 0000' });
  expect(res.status).toBe(400);
  expect(res.text).toContain('no SeniorPadi account yet');
  expect(res.text).toContain('/signup/parent');
});

test('the parent\'s code text says who is asking', () => {
  const sms = t('parent.book_code.sms', 'en', { name: 'Mama Tolu', child: 'Tunde', code: '123456', minutes: 10 });
  expect(sms).toContain('Tunde wants to book events for Mama Tolu');
  expect(sms).toContain('Only share it if you agree');
});

test('right after signing a parent up, the child can book for them straight away, with no new code', async () => {
  const { User } = require('../src/models');
  const agent = request.agent(app);
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const form = await agent.get('/signup/parent');
  await agent.post('/signup/parent').type('form').send({
    _csrf: csrfFrom(form.text), childName: 'Tunde', childPhone: '0805 111 2222',
    parentName: 'Mrs Esther Bello', parentPhone: '0805 333 4444', lga: 'ibadan-north', ageDeclared: 'yes'
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

test('while booking, events the parent already has are not offered again on Find events or the home page', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const booked = await makeEvent({ title: 'Painting class', ...later(3) });
  const other = await makeEvent({ title: 'Morning walk', ...later(5) });
  const agent = request.agent(app);
  await startBooking(agent, parent, booked.id);

  const registerFor = (event) => '/book-for-parent/' + event.id + '/register';
  const events = (await agent.get('/events')).text;
  expect(events).not.toContain(registerFor(booked));
  expect(events).toContain(registerFor(other));
  const home = (await agent.get('/')).text;
  expect(home).not.toContain(registerFor(booked));
  expect(home).toContain(registerFor(other));

  // a plain visitor still sees both
  const visitor = (await request(app).get('/events')).text;
  expect(visitor).toContain('Painting class');
  expect(visitor).toContain('Morning walk');
});

test('while booking, the child can see the parent\'s bookings and cancel one; the parent is texted who cancelled it', async () => {
  const notifier = require('../src/services/notify');
  const notify = jest.spyOn(notifier, 'notify');
  const { AuditLog } = require('../src/models');
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const agent = request.agent(app);
  await startBooking(agent, parent, event.id);

  const banner = (await agent.get('/events')).text;
  expect(banner).toContain('href="/book-for-parent/tickets"');
  const list = await agent.get('/book-for-parent/tickets');
  expect(list.status).toBe(200);
  expect(list.text).toContain('Mama Tolu’s bookings');
  expect(list.text).toContain('Painting class');
  const reg = await Registration.findOne({ where: { seniorId: parent.id, eventId: event.id } });
  expect(list.text).toContain(reg.ticketNumber);

  const res = await agent.post('/book-for-parent/registrations/' + reg.id + '/cancel').type('form').send({ _csrf: csrfFrom(list.text) });
  expect(res.headers.location).toBe('/book-for-parent/tickets');
  expect((await reg.reload()).status).toBe('cancelled');
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: parent.id }), 'event.cancelled_by_child', expect.objectContaining({ child: 'Tunde', event: 'Painting class' }), ['sms']);
  expect(await AuditLog.count({ where: { action: 'registration.cancelled_by_child', entityId: reg.id } })).toBe(1);
  const after = (await agent.get('/book-for-parent/tickets')).text;
  expect(after).toContain('Mama Tolu’s place at Painting class is cancelled');
  expect(after).toContain('Mama Tolu has no upcoming bookings');
  expect((await agent.get('/events')).text).toContain('/book-for-parent/' + event.id + '/register'); // offered again
  notify.mockRestore();
});

test('the child cannot see or cancel anyone else\'s bookings, or anything once booking has finished', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const stranger = await makeUser({ fullName: 'Baba Kunle' });
  const event = await makeEvent({ ...later(3) });
  const theirs = await Registration.create({ eventId: event.id, seniorId: stranger.id, type: 'attendee' });
  const agent = request.agent(app);
  await startBooking(agent, parent, null);

  let page = await agent.get('/book-for-parent/tickets');
  expect(page.text).not.toContain(theirs.ticketNumber);
  await agent.post('/book-for-parent/registrations/' + theirs.id + '/cancel').type('form').send({ _csrf: csrfFrom(page.text) });
  expect((await theirs.reload()).status).toBe('registered');

  const mine = await Registration.create({ eventId: event.id, seniorId: parent.id, type: 'attendee' });
  await agent.post('/book-for-parent/finish').type('form').send({ _csrf: csrfFrom(page.text) });
  expect((await agent.get('/book-for-parent/tickets')).headers.location).toBe('/book-for-parent');
  page = await agent.get('/book-for-parent');
  await agent.post('/book-for-parent/registrations/' + mine.id + '/cancel').type('form').send({ _csrf: csrfFrom(page.text) });
  expect((await mine.reload()).status).toBe('registered');
  expect((await request(app).get('/book-for-parent/tickets')).headers.location).toBe('/book-for-parent'); // a plain visitor
});

test('the Log in page has the "Booking for a parent" link for sons, daughters and carers', async () => {
  const login = (await request(app).get('/login')).text;
  expect(login).toContain('href="/book-for-parent"');
  expect(login).toContain('Booking for a parent or loved one?');
});

test('the child gives their own number too, and it cannot be the parent\'s', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const agent = request.agent(app);
  const page = await agent.get('/book-for-parent');
  expect(page.text).toContain('name="childPhone"');
  const missing = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: '', parentPhone: parent.localPhone() });
  expect(missing.status).toBe(400);
  const same = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: parent.localPhone(), parentPhone: parent.localPhone() });
  expect(same.status).toBe(400);
  expect(same.text).toContain('Your parent needs their own phone number');
  expect(await VerificationCode.count()).toBe(0); // no code sent
});

test('the child is texted a copy of each booking and cancellation, and the audit log keeps their number', async () => {
  const notifier = require('../src/services/notify');
  const sms = jest.spyOn(notifier, 'sendSms');
  const { AuditLog } = require('../src/models');
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const agent = request.agent(app);
  await startBooking(agent, parent, event.id);

  const reg = await Registration.findOne({ where: { seniorId: parent.id, eventId: event.id } });
  expect(sms).toHaveBeenCalledWith(expect.objectContaining({ phone: '+2348099990000' }), 'book.child_copy', expect.objectContaining({ parent: 'Mama Tolu', event: 'Painting class', ticket: reg.ticketNumber }));
  const booked = await AuditLog.findOne({ where: { action: 'registration.booked_by_child', entityId: reg.id } });
  expect(JSON.stringify(booked.toJSON())).toContain('+2348099990000');

  const list = await agent.get('/book-for-parent/tickets');
  await agent.post('/book-for-parent/registrations/' + reg.id + '/cancel').type('form').send({ _csrf: csrfFrom(list.text) });
  expect(sms).toHaveBeenCalledWith(expect.objectContaining({ phone: '+2348099990000' }), 'book.child_cancel', expect.objectContaining({ parent: 'Mama Tolu', event: 'Painting class' }));
  sms.mockRestore();
});

test('next time on the same phone the form is already filled in, and "Not Tunde? Clear" forgets it', async () => {
  const parent = await makeUser({ fullName: 'Mama Tolu Adeyemi' });
  const agent = request.agent(app);
  await startBooking(agent, parent, null);
  let page = await agent.get('/events');
  await agent.post('/book-for-parent/finish').type('form').send({ _csrf: csrfFrom(page.text) });

  page = await agent.get('/book-for-parent');
  expect(page.text).toContain('Welcome back, Tunde');
  expect(page.text).toContain('value="Tunde"');
  expect(page.text).toContain('08099990000');
  expect(page.text).toContain(parent.localPhone());
  // the parent's code is still needed: sending the form only sends a code
  const sent = await agent.post('/book-for-parent').type('form').send({ _csrf: csrfFrom(page.text), childName: 'Tunde', childPhone: '08099990000', parentPhone: parent.localPhone() });
  expect(sent.headers.location).toBe('/book-for-parent/code');

  page = await agent.get('/book-for-parent');
  await agent.post('/book-for-parent/forget').type('form').send({ _csrf: csrfFrom(page.text) });
  page = await agent.get('/book-for-parent');
  expect(page.text).not.toContain('Welcome back');
  expect(page.text).not.toContain('08099990000');
  // a different phone never sees it
  expect((await request(app).get('/book-for-parent')).text).not.toContain('Welcome back');
});

test('after signing a parent up, the booking form remembers the child too', async () => {
  const { User } = require('../src/models');
  const agent = request.agent(app);
  const form = await agent.get('/signup/parent');
  await agent.post('/signup/parent').type('form').send({
    _csrf: csrfFrom(form.text), childName: 'Tunde', childPhone: '0805 111 2222',
    parentName: 'Mrs Esther Bello', parentPhone: '0805 333 4444', lga: 'ibadan-north', ageDeclared: 'yes'
  });
  const parent = await User.findOne({ where: { fullName: 'Mrs Esther Bello' } });
  const codePage = await agent.get('/signup/parent/code');
  await agent.post('/signup/parent/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(parent.id) });

  const page = await agent.get('/book-for-parent');
  expect(page.text).toContain('Welcome back, Tunde');
  expect(page.text).toContain('08051112222');
  expect(page.text).toContain('08053334444');
});
