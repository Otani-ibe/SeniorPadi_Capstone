const request = require('supertest');
const app = require('../src/app');
const { Registration, VerificationCode, User } = require('../src/models');
const { lastCodeForTests } = require('../src/services/verification');
const { t } = require('../src/services/i18n');
const { rankEvents } = require('../src/services/recommend');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  await signIn(agent, phone);
  return agent;
}

const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000) });

test('events of a type the senior joined before are ranked first, then the soonest', () => {
  const events = [
    { id: 1, category: 'social', organizationId: 1, startsAt: new Date(Date.now() + DAY) },
    { id: 2, category: 'fitness', organizationId: 2, startsAt: new Date(Date.now() + 5 * DAY) },
    { id: 3, category: 'social', organizationId: 1, startsAt: new Date(Date.now() + 3 * DAY) }
  ];
  const history = [{ category: 'fitness', organizationId: 2 }, { category: 'fitness', organizationId: 2 }];
  expect(rankEvents(events, history, {}).map((e) => e.id)).toEqual([2, 1, 3]);
  expect(rankEvents(events, [], {}).map((e) => e.id)).toEqual([1, 3, 2]); // no history: soonest first
});

test('signed-in seniors see recommendations based on what they joined before, never ones they already booked', async () => {
  const me = await makeUser();
  const past = await makeEvent({ title: 'Morning aerobics', category: 'fitness', ...later(2) });
  await Registration.update({ status: 'attended' }, { where: { eventId: past.id } }).catch(() => {});
  await Registration.create({ eventId: past.id, seniorId: me.id, type: 'attendee', status: 'attended' });
  await makeEvent({ title: 'Bible study', category: 'faith', ...later(3) });
  await makeEvent({ title: 'Evening aerobics', category: 'fitness', ...later(6) });
  const booked = await makeEvent({ title: 'Already booked class', category: 'fitness', ...later(4) });
  await Registration.create({ eventId: booked.id, seniorId: me.id, type: 'attendee', status: 'registered' });

  const agent = await loggedInAgent(me.phone);
  const page = await agent.get('/');
  expect(page.text).toContain('Picked for you');
  expect(page.text).not.toContain('Already booked class');
  expect(page.text.indexOf('Evening aerobics')).toBeLessThan(page.text.indexOf('Bible study'));
});

test('a visitor sees upcoming events soonest first, and tapping one leads to sign-up for that event', async () => {
  await makeEvent({ title: 'Later event', ...later(9) });
  const soon = await makeEvent({ title: 'Soon event', ...later(2) });
  const page = await request(app).get('/');
  expect(page.text).toContain('Upcoming events');
  expect(page.text).not.toContain('Picked for you');
  expect(page.text.indexOf('Soon event')).toBeLessThan(page.text.indexOf('Later event'));
  expect(page.text).toContain('/signup?register=' + soon.id);
});

test('full events are not recommended', async () => {
  const event = await makeEvent({ title: 'Packed event', capacity: 1, ...later(3) });
  const someone = await makeUser();
  await Registration.create({ eventId: event.id, seniorId: someone.id, type: 'attendee' });
  const page = await request(app).get('/');
  expect(page.text).not.toContain('Packed event');
});

test('a visitor who picks an event signs up with just a name and number, types the texted code, and is registered', async () => {
  const event = await makeEvent({ title: 'Painting class', locationText: 'Mapo Hall, near the big tree, Ibadan', ...later(3) });
  const agent = request.agent(app);
  const page = await agent.get('/signup?register=' + event.id);
  const res = await agent.post('/signup').type('form').send({
    _csrf: csrfFrom(page.text), registerEventId: String(event.id),
    fullName: 'Mama Tolu', phone: '0805 123 4567', ageDeclared: 'yes'
  });
  expect(res.headers.location).toBe('/login/code');
  expect(await VerificationCode.count()).toBe(1); // the code was texted

  const user = await User.findOne({ where: { fullName: 'Mama Tolu' } });
  const codePage = await agent.get('/login/code');
  expect(codePage.text).toContain('name="code"');
  expect(codePage.text).toContain('/login/code/resend'); // and they can ask for it again

  const done = await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(user.id) });
  expect(done.headers.location).toBe('/events/' + event.id + '/registered');
  expect(await Registration.count({ where: { seniorId: user.id, eventId: event.id } })).toBe(1);
});

test('the registration text has the name, event, ticket number, date and the venue exactly as the admin wrote it', () => {
  const place = 'Mapo Hall, opposite the post office, Ibadan';
  const sms = t('event.registered.sms', 'en', { name: 'Tolu', event: 'Painting class', ticket: 'SP-ABC234', date: '15 Dec', time: '11:00 am', place });
  expect(sms).toBe('Hi Tolu, thank you for registering for Painting class. Your ticket number is SP-ABC234. Date: 15 Dec, 11:00 am. Venue: ' + place);
});

test('registering from the home page keeps the senior on the home page, with the ticket pop-up over it', async () => {
  const me = await makeUser({ onboardingSeenAt: new Date() });
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const agent = await loggedInAgent(me.phone);

  const home = await agent.get('/');
  expect(home.text).toContain('name="from" value="home"');
  const res = await agent.post('/events/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(home.text), from: 'home' });
  expect(res.headers.location).toBe('/?registered=' + event.id + '#events'); // lands on the events, not the top

  const after = await agent.get('/?registered=' + event.id);
  const reg = await Registration.findOne({ where: { seniorId: me.id, eventId: event.id } });
  expect(after.text).toContain(reg.ticketNumber);          // the ticket pop-up is on the home page
  expect(after.text).toMatch(/Picked for you/);            // and it is still the recommended page behind it
  expect(after.text).toMatch(/href="\/#events"[^>]*>\s*<i class="fa-solid fa-xmark/);
  expect(after.text).toContain('id="events"'); // Close goes back to the home page
});

test('a visitor who started on the home page comes back to it, with the ticket, after the code', async () => {
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const agent = request.agent(app);
  const page = await agent.get('/signup?register=' + event.id + '&from=home');
  await agent.post('/signup').type('form').send({
    _csrf: csrfFrom(page.text), registerEventId: String(event.id), from: 'home',
    fullName: 'Mama Tolu', phone: '0805 123 4567', ageDeclared: 'yes'
  });
  const user = await User.findOne({ where: { fullName: 'Mama Tolu' } });
  const codePage = await agent.get('/login/code');
  const done = await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(user.id) });
  expect(done.headers.location).toBe('/?registered=' + event.id + '#events');
});

test('on an event page, a visitor\'s Create account and Log in links remember the event', async () => {
  const event = await makeEvent({ title: 'Painting class', ...later(3) });
  const page = await request(app).get('/events/' + event.id);
  expect(page.text).toContain('/signup?register=' + event.id);
  expect(page.text).toContain('/login?register=' + event.id);
});
