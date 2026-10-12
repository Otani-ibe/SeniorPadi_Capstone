const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone, password: 'password123' });
  return agent;
}

test('Find events shows one card, and Skip moves to the next one', async () => {
  await makeEvent({ title: 'First event' });
  await makeEvent({ title: 'Second event', startsAt: new Date(Date.now() + 4 * DAY), endsAt: new Date(Date.now() + 4 * DAY + 3600000) });
  const agent = request.agent(app);

  let page = await agent.get('/events');
  expect(page.text).toMatch(/First event/);
  expect(page.text).not.toMatch(/Second event/);

  const firstId = page.text.match(/\/events\/(\d+)\/skip/)[1];
  await agent.post('/events/' + firstId + '/skip').type('form').send({ _csrf: csrfFrom(page.text) });
  page = await agent.get('/events');
  expect(page.text).toMatch(/Second event/);
});

test('full events are not shown at all', async () => {
  const event = await makeEvent({ title: 'Packed event', capacity: 1 });
  const someone = await makeUser();
  await Registration.create({ eventId: event.id, seniorId: someone.id, type: 'attendee' });
  const page = await request(app).get('/events');
  expect(page.text).not.toMatch(/Packed event/);
});

test('a visitor tapping Register gets the log-in pop-up, and logging in registers them', async () => {
  const user = await makeUser({ onboardingSeenAt: new Date() });
  const event = await makeEvent();
  const agent = request.agent(app);

  const page = await agent.get('/events?login=' + event.id + '&mode=login');
  expect(page.text).toMatch(/Log in to register/);

  const res = await agent.post('/login').type('form').send({
    _csrf: csrfFrom(page.text), phone: user.phone, password: 'password123', registerEventId: String(event.id)
  });
  expect(res.headers.location).toBe('/events/' + event.id + '/registered');
  expect(await Registration.count({ where: { eventId: event.id, seniorId: user.id, type: 'attendee' } })).toBe(1);
});

test('the registered pop-up offers volunteering, and Yes signs them up', async () => {
  const user = await makeUser();
  const event = await makeEvent({ volunteerEnabled: true, volunteerCapacity: 3 });
  const agent = await loggedInAgent(user.phone);

  const card = await agent.get('/events');
  await agent.post('/events/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(card.text) });

  const popup = await agent.get('/events/' + event.id + '/registered');
  expect(popup.text).toMatch(/volunteer at this event/);

  const res = await agent.post('/events/' + event.id + '/volunteer').type('form').send({ _csrf: csrfFrom(popup.text), from: 'popup' });
  expect(res.headers.location).toBe('/events');
  expect(await Registration.count({ where: { eventId: event.id, seniorId: user.id, type: 'volunteer' } })).toBe(1);
});

test('Find seniors asks visitors to log in first', async () => {
  const page = await request(app).get('/find-seniors');
  expect(page.status).toBe(200);
  expect(page.text).toMatch(/Log in to find seniors/);
});

test('the language button shows the other language', async () => {
  const page = await request(app).get('/');
  expect(page.text).toMatch(/name="lang" value="yo"/);
});
