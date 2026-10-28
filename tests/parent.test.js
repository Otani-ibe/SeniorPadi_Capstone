const request = require('supertest');
const app = require('../src/app');
const { User, VerificationCode } = require('../src/models');
const { lastCodeForTests } = require('../src/services/verification');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, csrfFrom, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const form = (extra = {}) => ({
  childName: 'Tunde Adeyemi', childPhone: '0805 111 2222',
  parentName: 'Mama Tolu Adeyemi', parentPhone: '0805 333 4444', ageDeclared: 'yes', ...extra
});

async function sendForm(agent, extra) {
  const page = await agent.get('/signup/parent');
  return agent.post('/signup/parent').type('form').send({ _csrf: csrfFrom(page.text), ...form(extra) });
}

test('only the Join page has the small link for sons and daughters; Log in and the event pop-up do not', async () => {
  const join = await request(app).get('/signup');
  expect(join.text).toContain('href="/signup/parent"');
  expect(join.text).toContain('Are you a family member or caregiver?');
  expect(join.text).toContain('Create an account for your parent or loved one');
  expect((await request(app).get('/login')).text).not.toContain('/signup/parent');
  // (the "having trouble?" help pop-up at the end of the page is separate, and only opens after a while)
  const popup = (await request(app).get('/events?login=1&mode=signup')).text.split('data-help-nudge')[0];
  expect(popup).not.toContain('/signup/parent');
  expect(join.text).toContain('I am 50 years old or older');       // the original wording
  expect(join.text).not.toMatch(/Setting this up for your mum or dad\?\s*Use their name/);
});

test('the parent form asks for the child\'s name and number and the parent\'s name and number', async () => {
  const page = await request(app).get('/signup/parent');
  for (const field of ['childName', 'childPhone', 'parentName', 'parentPhone', 'ageDeclared']) {
    expect(page.text).toContain('name="' + field + '"');
  }
  expect(page.text).not.toContain('name="password"');
});

test('the code goes to the PARENT\'s phone, and the page says so', async () => {
  const agent = request.agent(app);
  const res = await sendForm(agent);
  expect(res.headers.location).toBe('/signup/parent/code');

  const parent = await User.findOne({ where: { fullName: 'Mama Tolu Adeyemi' } });
  expect(parent).not.toBeNull();
  expect(parent.phone).toBe('+2348053334444');
  expect(await VerificationCode.count({ where: { userId: parent.id } })).toBe(1);   // the code belongs to the parent
  expect(await User.count()).toBe(1);                                              // the child gets no account

  const page = await agent.get('/signup/parent/code');
  expect(page.text).toContain('A code has been sent to your parent');
  expect(page.text).toContain(parent.localPhone());
  expect(page.text).toContain('Ask them to read it to you');
  expect(page.text).toContain('/signup/parent/code/resend');
});

test('when the code is confirmed the child is told, the account is the parent\'s, and nobody is signed in', async () => {
  const agent = request.agent(app);
  await sendForm(agent);
  const parent = await User.findOne({ where: { fullName: 'Mama Tolu Adeyemi' } });
  const codePage = await agent.get('/signup/parent/code');

  const done = await agent.post('/signup/parent/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: lastCodeForTests(parent.id) });
  expect(done.status).toBe(200);
  expect(done.text).toContain('You have successfully created an account for Mama Tolu Adeyemi');

  await parent.reload();
  expect(parent.phoneVerifiedAt).not.toBeNull();
  expect(parent.createdByName).toBe('Tunde Adeyemi');
  expect(parent.createdByPhone).toBe('+2348051112222');
  expect((await agent.get('/account')).headers.location).toBe('/login'); // the child is not signed in as the parent
});

test('the three texts say what they should', () => {
  const toParentCode = t('parent.code.sms', 'en', { child: 'Tunde', code: '123456', minutes: 10 });
  expect(toParentCode).toContain('Tunde is creating an account for you');
  expect(toParentCode).toContain('123456');
  expect(t('parent.created_child.sms', 'en', { parent: 'Mama Tolu' })).toBe('SeniorPadi: you have successfully created an account for Mama Tolu.');
  expect(t('parent.created_parent.sms', 'en', { name: 'Tolu', child: 'Tunde' })).toContain('your child Tunde has created an account for you');
});

test('a wrong code does not create the account', async () => {
  const agent = request.agent(app);
  await sendForm(agent);
  const codePage = await agent.get('/signup/parent/code');
  const res = await agent.post('/signup/parent/code').type('form').send({ _csrf: csrfFrom(codePage.text), code: '000000' });
  expect(res.headers.location).toBe('/signup/parent/code');
  const parent = await User.findOne({ where: { fullName: 'Mama Tolu Adeyemi' } });
  expect(parent.phoneVerifiedAt).toBeNull();
});

test('asking for the code again sends a new one to the parent', async () => {
  const agent = request.agent(app);
  await sendForm(agent);
  const parent = await User.findOne({ where: { fullName: 'Mama Tolu Adeyemi' } });
  const first = lastCodeForTests(parent.id);
  const page = await agent.get('/signup/parent/code');
  const res = await agent.post('/signup/parent/code/resend').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(res.headers.location).toBe('/signup/parent/code');
  expect(lastCodeForTests(parent.id)).not.toBe(first);
});

test('the form refuses the same number twice, a missing tick, or a parent who already has an account', async () => {
  const agent = request.agent(app);
  let res = await sendForm(agent, { parentPhone: '0805 111 2222' });
  expect(res.status).toBe(400);
  expect(res.text).toContain('needs their own phone number');

  res = await sendForm(agent, { ageDeclared: undefined });
  expect(res.status).toBe(400);

  const existing = await makeUser();
  res = await sendForm(agent, { parentPhone: existing.localPhone() });
  expect(res.status).toBe(400);
  expect(res.text).toContain('already has an account');
});

test('without starting the form there is no code page', async () => {
  const res = await request(app).get('/signup/parent/code');
  expect(res.headers.location).toBe('/signup/parent');
});
