const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize } = require('./helpers');

beforeAll(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  await agent.post('/login').type('form').send({
    _csrf: csrfFrom(page.text),
    phone,
    password: 'password123'
  });
  return agent;
}

test('a senior can sign up with a plain form (no JavaScript)', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/signup');
  const res = await agent.post('/signup').type('form').send({
    _csrf: csrfFrom(page.text),
    fullName: 'Mama Tolu',
    phone: '0805 123 4567',
    password: 'secret123',
    ageDeclared: 'yes'
  });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/onboarding');
});

test('signup needs the 60+ box ticked', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/signup');
  const res = await agent.post('/signup').type('form').send({
    _csrf: csrfFrom(page.text),
    fullName: 'Young Person',
    phone: '0805 999 4567',
    password: 'secret123'
  });
  expect(res.status).toBe(400);
});

test('registering for an event works with a plain form POST', async () => {
  const user = await makeUser();
  const event = await makeEvent();
  const agent = await loggedInAgent(user.phone);

  const page = await agent.get('/events/' + event.id);
  const res = await agent.post('/events/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(page.text) });

  expect(res.headers.location).toBe('/events/' + event.id + '/confirmed?type=attendee');
  expect(await Registration.count({ where: { eventId: event.id, seniorId: user.id } })).toBe(1);
});

test('registration counts are never shown to seniors', async () => {
  const user = await makeUser();
  const event = await makeEvent({ capacity: 997 });
  const agent = await loggedInAgent(user.phone);
  const page = await agent.get('/events/' + event.id);
  expect(page.text).not.toMatch(/997/);
});

test('forms without the CSRF token are rejected', async () => {
  const user = await makeUser();
  const event = await makeEvent();
  const agent = await loggedInAgent(user.phone);
  const res = await agent.post('/events/' + event.id + '/register').type('form').send({});
  expect(res.status).toBe(403);
});

test('seniors cannot open admin pages', async () => {
  const user = await makeUser();
  const agent = await loggedInAgent(user.phone);
  const res = await agent.get('/admin');
  expect(res.status).toBe(403);
});

test('admin can mark attendance from the manual list', async () => {
  const admin = await makeUser({ role: 'admin' });
  const senior = await makeUser();
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });

  const agent = await loggedInAgent(admin.phone);
  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/attendance').type('form').send({
    _csrf: csrfFrom(page.text),
    ['status_' + reg.id]: 'attended'
  });

  await reg.reload();
  expect(reg.status).toBe('attended');
});
