const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  await signIn(agent, phone);
  return agent;
}

// the title of the card on top of the deck
const topTitle = (html) => html.match(/data-pos="0"[\s\S]*?<h2[^>]*>([^<]+)</)[1].trim();

test('Find events puts one card on top, and skipped ones only come back if the senior asks', async () => {
  await makeEvent({ title: 'First event' });
  await makeEvent({ title: 'Second event', startsAt: new Date(Date.now() + 4 * DAY), endsAt: new Date(Date.now() + 4 * DAY + 3600000) });
  const agent = request.agent(app);

  let page = await agent.get('/events');
  expect(topTitle(page.text)).toBe('First event');

  const skipTop = async () => {
    const id = page.text.match(/\/events\/(\d+)\/skip/)[1];
    await agent.post('/events/' + id + '/skip').type('form').send({ _csrf: csrfFrom(page.text) });
    page = await agent.get('/events');
  };

  await skipTop();
  expect(topTitle(page.text)).toBe('Second event');
  expect(page.text).toMatch(/data-see-skipped >/); // the See skipped events button is showing
  await skipTop(); // both skipped: no cards, just the offer to see the skipped ones
  expect(page.text).not.toMatch(/data-deck-card/);
  expect(page.text).toMatch(/seen all the events here/);
  expect(page.text).toMatch(/skipped=1/);

  page = await agent.get('/events?area=all&skipped=1');
  expect(topTitle(page.text)).toBe('First event'); // in the order they were skipped
  expect(page.text).toMatch(/These are the events you skipped/);
});

test('Find events shows all of Ibadan to everyone, whatever area a senior has, and they can filter by area', async () => {
  const me = await makeUser({ lga: 'egbeda' });
  await makeEvent({ title: 'Egbeda games', area: 'egbeda' });
  await makeEvent({ title: 'Bodija walk', area: 'ibadan-north' });
  const agent = await loggedInAgent(me.phone);

  for (const client of [agent, request(app)]) { // signed in, or not signed in
    const page = await client.get('/events');
    expect(page.text).toMatch(/Egbeda games/);
    expect(page.text).toMatch(/Bodija walk/);
    expect(page.text).not.toMatch(/where you live/);
  }

  const filtered = await agent.get('/events?area=ibadan-north');
  expect(filtered.text).toMatch(/Bodija walk/);
  expect(filtered.text).not.toMatch(/Egbeda games/);
});

test('Find events can be filtered by local government area', async () => {
  await makeEvent({ title: 'Bodija walk', area: 'ibadan-north' });
  await makeEvent({ title: 'Egbeda games', area: 'egbeda' });
  const page = await request(app).get('/events?area=egbeda');
  expect(page.text).toMatch(/Egbeda games/);
  expect(page.text).not.toMatch(/Bodija walk/);
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

  // the pop-up asks for the phone number only; a code is texted and typing it registers them
  expect(page.text).not.toContain('name="password"');
  const res = await signIn(agent, user.phone, { registerEventId: String(event.id) });
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
