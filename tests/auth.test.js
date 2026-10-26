const request = require('supertest');
const app = require('../src/app');
const { User } = require('../src/models');
const { lastCodeForTests } = require('../src/services/verification');
const { resetDb, makeUser, csrfFrom, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function asksForCode(agent, phone) {
  const page = await agent.get('/login');
  return agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone });
}

test('the log-in page asks for a phone number only, no password', async () => {
  const page = await request(app).get('/login');
  expect(page.text).toContain('name="phone"');
  expect(page.text).not.toContain('name="password"');
  expect(page.text).not.toContain('/forgot-password');
});

test('a senior logs in with their phone number and the code we text them', async () => {
  const user = await makeUser({ onboardingSeenAt: new Date() });
  const agent = request.agent(app);
  const first = await asksForCode(agent, user.phone);
  expect(first.headers.location).toBe('/login/code');
  expect((await agent.get('/account')).headers.location).toBe('/login'); // not signed in yet

  const form = await agent.get('/login/code');
  const done = await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(form.text), code: lastCodeForTests(user.id) });
  expect(done.headers.location).toBe('/account'); // back to the page they were sent away from
  expect((await agent.get('/account')).status).toBe(200);
});

test('a wrong code does not sign anyone in', async () => {
  const user = await makeUser();
  const agent = request.agent(app);
  await asksForCode(agent, user.phone);
  const form = await agent.get('/login/code');
  const res = await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(form.text), code: '000000' });
  expect(res.headers.location).toBe('/login/code');
  expect((await agent.get('/account')).headers.location).toBe('/login');
});

test('the old password no longer works for seniors', async () => {
  const user = await makeUser();
  const agent = request.agent(app);
  const page = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone: user.phone, password: 'password123' });
  expect(res.headers.location).toBe('/login/code'); // the password is ignored, a code is still needed
  expect((await agent.get('/account')).headers.location).toBe('/login');
});

test('asking for the code again sends a new one', async () => {
  const user = await makeUser();
  const agent = request.agent(app);
  await asksForCode(agent, user.phone);
  const firstCode = lastCodeForTests(user.id);
  const form = await agent.get('/login/code');
  const res = await agent.post('/login/code/resend').type('form').send({ _csrf: csrfFrom(form.text) });
  expect(res.headers.location).toBe('/login/code');
  expect(lastCodeForTests(user.id)).not.toBe(firstCode);
});

test('an unknown number is told so, and nobody gets a code page', async () => {
  const agent = request.agent(app);
  const res = await asksForCode(agent, '08099999999');
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/does not have a SeniorPadi account/);
  expect((await agent.get('/login/code')).headers.location).toBe('/login');
});

test('signing up with a number that already has an account is refused', async () => {
  const user = await makeUser();
  const agent = request.agent(app);
  const page = await agent.get('/signup');
  const res = await agent.post('/signup').type('form').send({
    _csrf: csrfFrom(page.text), fullName: 'Someone Else', phone: user.phone, ageDeclared: 'yes'
  });
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/already has an account/);
});

test('a number that never typed its code can sign up again, and is not signed in until it does', async () => {
  const agent = request.agent(app);
  for (const name of ['First Try', 'Second Try']) {
    const page = await agent.get('/signup');
    const res = await agent.post('/signup').type('form').send({
      _csrf: csrfFrom(page.text), fullName: name, phone: '0805 777 1234', ageDeclared: 'yes'
    });
    expect(res.headers.location).toBe('/login/code');
    expect((await agent.get('/account')).headers.location).toBe('/login');
  }
  expect(await User.count()).toBe(1);
  expect((await User.findOne()).fullName).toBe('Second Try');
});

test('staff still sign in with a password, and a wrong one is refused', async () => {
  const admin = await makeUser({ role: 'admin' });
  const agent = request.agent(app);
  const first = await asksForCode(agent, admin.phone);
  expect(first.headers.location).toBe('/login/password');

  let form = await agent.get('/login/password');
  const bad = await agent.post('/login/password').type('form').send({ _csrf: csrfFrom(form.text), password: 'nope' });
  expect(bad.status).toBe(400);

  form = await agent.get('/login/password');
  const good = await agent.post('/login/password').type('form').send({ _csrf: csrfFrom(form.text), password: 'password123' });
  expect(good.headers.location).toBe('/admin');
});
