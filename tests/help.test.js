const request = require('supertest');
const app = require('../src/app');
const { resetDb, makeUser, signIn, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

test('visitors see the moving "Need a hand?" strip on the home page, and every page has the help pop-up ready', async () => {
  const home = await request(app).get('/');
  expect(home.text).toContain('data-ticker');
  expect(home.text).toContain('Finding it hard to sign up?');
  expect(home.text).toContain('href="/signup/parent"');
  expect(home.text).toMatch(/data-help-nudge data-wait="\d+" hidden/); // hidden until they have done nothing for a while
  expect((await request(app).get('/events')).text).toContain('Having trouble registering for an event?');
});

test('the family pages themselves do not offer the pop-up', async () => {
  expect((await request(app).get('/signup/parent')).text).not.toContain('data-help-nudge');
});

test('a signed-in senior sees neither', async () => {
  const me = await makeUser({ onboardingSeenAt: new Date() });
  const agent = request.agent(app);
  await signIn(agent, me.phone);
  const home = await agent.get('/');
  expect(home.text).not.toContain('data-ticker');
  expect(home.text).not.toContain('data-help-nudge');
});
