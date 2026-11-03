// Search on My registrations: by event name, place, host or ticket number.
const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, signIn, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function seniorWithTwoPlaces() {
  const senior = await makeUser();
  const walk = await makeEvent({ title: 'Morning walk at Agodi', locationText: 'Agodi Gardens, Ibadan' });
  const sewing = await makeEvent({ title: 'Basic sewing class', locationText: 'Mokola Cultural Centre' });
  const a = await Registration.create({ eventId: walk.id, seniorId: senior.id, type: 'attendee' });
  const b = await Registration.create({ eventId: sewing.id, seniorId: senior.id, type: 'volunteer' });
  const agent = request.agent(app);
  await signIn(agent, senior.phone);
  return { agent, a, b };
}

test('no search: everything is listed, with the search box', async () => {
  const { agent } = await seniorWithTwoPlaces();
  const page = await agent.get('/registrations');
  expect(page.text).toContain('Morning walk at Agodi');
  expect(page.text).toContain('Basic sewing class');
  expect(page.text).toContain('role="search"');
});

test('search by name, by place and by ticket number', async () => {
  const { agent, a } = await seniorWithTwoPlaces();

  const byName = (await agent.get('/registrations?q=sewing')).text;
  expect(byName).toContain('Basic sewing class');
  expect(byName).not.toContain('Morning walk at Agodi');

  const byPlace = (await agent.get('/registrations?q=agodi gardens')).text;
  expect(byPlace).toContain('Morning walk at Agodi');
  expect(byPlace).not.toContain('Basic sewing class');

  const byTicket = (await agent.get('/registrations?q=' + a.ticketNumber.toLowerCase())).text;
  expect(byTicket).toContain('Morning walk at Agodi');
  expect(byTicket).not.toContain('Basic sewing class');
});

test('capital letters, extra spaces and several words do not matter', async () => {
  const { agent } = await seniorWithTwoPlaces();
  const page = (await agent.get('/registrations?q=%20%20MORNING%20%20agodi%20')).text;
  expect(page).toContain('Morning walk at Agodi');
  expect(page).not.toContain('Basic sewing class');
});

test('nothing matches: a plain message and a way back, and wildcard characters are just text', async () => {
  const { agent } = await seniorWithTwoPlaces();
  const none = (await agent.get('/registrations?q=zzz')).text;
  expect(none).toContain('None of your registrations match');
  expect(none).toContain('Show all');
  expect(none).not.toContain('Morning walk at Agodi');

  const wildcard = (await agent.get('/registrations?q=%25')).text;
  expect(wildcard).toContain('None of your registrations match');
});

test('a senior with no registrations sees no search box, and only sees their own', async () => {
  const other = await seniorWithTwoPlaces();
  const lonely = await makeUser();
  const agent = request.agent(app);
  await signIn(agent, lonely.phone);
  const page = (await agent.get('/registrations?q=walk')).text;
  expect(page).not.toContain('role="search"');
  expect(page).not.toContain('Morning walk at Agodi');
  expect(other.agent).toBeTruthy();
});
