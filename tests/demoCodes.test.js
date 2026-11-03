// presentation mode: login code shown on the page. Off unless switched on, limited on the live site
const request = require('supertest');
const app = require('../src/app');
const demo = require('../src/services/demoCodes');
const { lastCodeForTests, demoCodeFor } = require('../src/services/verification');
const { resetDb, makeUser, csrfFrom, signIn, sequelize } = require('./helpers');

const NAMES = ['DEMO_SHOW_CODES', 'DEMO_SHOW_CODES_UNTIL', 'DEMO_ACCOUNTS', 'RENDER'];
const saved = {};
beforeAll(() => NAMES.forEach((n) => { saved[n] = process.env[n]; }));
beforeEach(async () => { NAMES.forEach((n) => delete process.env[n]); await resetDb(); });
afterAll(async () => { NAMES.forEach((n) => { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }); await sequelize.close(); });

const FUTURE = '2099-01-01 10:00';

// opens the login code page the way a person would: type the number, land on "type your code"
async function codePageFor(user) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone: user.phone });
  return { agent, page: await agent.get('/login/code') };
}

describe('off by default', () => {
  test('without the switch, no code is on the page', async () => {
    const user = await makeUser();
    const { page } = await codePageFor(user);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('data-shown-code');
    expect(page.text).not.toContain(lastCodeForTests(user.id)); // the real code is not in the page anywhere
    expect(demo.status().on).toBe(false);
  });

  test('anything but exactly "true" is off', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      process.env.DEMO_SHOW_CODES = value;
      expect(demo.status().on).toBe(false);
    }
  });
});

describe('switched on (on a computer, no end time needed)', () => {
  beforeEach(() => { process.env.DEMO_SHOW_CODES = 'true'; });

  test('the page says "Your code is ..." with the real code, and typing it logs in', async () => {
    const user = await makeUser();
    const { agent, page } = await codePageFor(user);
    const code = lastCodeForTests(user.id);
    expect(page.text).toContain('data-shown-code');
    expect(page.text).toContain('Your code is ' + code);
    expect(page.text).not.toMatch(/demo/i); // it just shows the code, it does not announce anything

    const res = await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(page.text), code });
    expect(res.headers.location).toBe('/');
    expect((await agent.get('/account')).status).toBe(200);
  });

  test('the login itself is unchanged: a wrong code is still refused', async () => {
    const user = await makeUser();
    const { agent, page } = await codePageFor(user);
    const wrong = String((Number(lastCodeForTests(user.id)) % 900000) + 100000 + 1).slice(0, 6);
    await agent.post('/login/code').type('form').send({ _csrf: csrfFrom(page.text), code: wrong === lastCodeForTests(user.id) ? '000000' : wrong });
    expect((await agent.get('/account')).headers.location).toBe('/login');
  });

  test('the words exist in Yorùbá too', () => {
    const { t } = require('../src/services/i18n');
    expect(t('demo.your_code', 'yo', { code: '123456' })).toBe('Kóòdù yín ni 123456');
    expect(t('demo.your_code', 'en', { code: '123456' })).toBe('Your code is 123456');
  });

  test('the code of someone else, or an old one, is never shown', async () => {
    const first = await makeUser();
    const second = await makeUser();
    await codePageFor(first);
    const { page } = await codePageFor(second);
    expect(page.text).toContain(lastCodeForTests(second.id));
    expect(page.text).not.toContain('Your code is ' + lastCodeForTests(first.id)); // each page shows its own person's code

    // after the ten minutes a code works for, it is not shown any more
    const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    try {
      expect(demoCodeFor(second)).toBeNull();
    } finally {
      later.mockRestore();
    }
    expect(demoCodeFor(second)).toBe(lastCodeForTests(second.id));
  });

  test('staff accounts never show a code, even when switched on', () => {
    expect(demo.allowedFor({ role: 'admin', phone: '+2348031112222' })).toBe(false);
    expect(demo.allowedFor({ role: 'admin', isSuperAdmin: true, phone: '+2348031112222' })).toBe(false);
    expect(demo.allowedFor({ role: 'senior', phone: '+2348031112222' })).toBe(true);
    expect(demo.allowedFor(null)).toBe(false);
  });

  test('with a list of accounts, only those show their code', async () => {
    process.env.DEMO_ACCOUNTS = '08031112222, 08033334444';
    const listed = await makeUser({ phone: '+2348031112222' });
    const other = await makeUser({ phone: '+2348039998888' });
    expect((await codePageFor(listed)).page.text).toContain('Your code is ' + lastCodeForTests(listed.id));
    expect((await codePageFor(other)).page.text).not.toContain('data-shown-code');
  });

  test('the phone-confirmation page and the sign-up-for-a-parent page show it too', async () => {
    const user = await makeUser();
    const agent = request.agent(app);
    await signIn(agent, user.phone);
    await user.update({ phoneVerifiedAt: null }); // asked to confirm their phone again
    const verify = await agent.get('/verify');
    expect(verify.text).toContain('Your code is ' + lastCodeForTests(user.id));

    const family = request.agent(app);
    const form = await family.get('/signup/parent');
    await family.post('/signup/parent').type('form').send({
      _csrf: csrfFrom(form.text), childName: 'Tunde', childPhone: '0805 111 2222', parentName: 'Mama Tolu Bello', parentPhone: '0805 333 4444', lga: 'ibadan-north', ageDeclared: 'yes'
    });
    const { User } = require('../src/models');
    const parent = await User.findOne({ where: { fullName: 'Mama Tolu Bello' } });
    expect((await family.get('/signup/parent/code')).text).toContain('Your code is ' + lastCodeForTests(parent.id));
  });
});

describe('on the live site (Render)', () => {
  beforeEach(() => { process.env.RENDER = 'true'; process.env.DEMO_SHOW_CODES = 'true'; });

  test('without an end time it does nothing, even if the switch is on', async () => {
    expect(demo.status()).toMatchObject({ on: false, reason: 'the live site needs DEMO_SHOW_CODES_UNTIL' });
    const user = await makeUser();
    expect((await codePageFor(user)).page.text).not.toContain('data-shown-code');
  });

  test('with an end time in the future it works, and a time with no zone is Lagos time', async () => {
    process.env.DEMO_SHOW_CODES_UNTIL = FUTURE;
    const s = demo.status();
    expect(s.on).toBe(true);
    expect(s.until.toISOString()).toBe('2099-01-01T09:00:00.000Z'); // 10:00 in Lagos
    process.env.DEMO_SHOW_CODES_UNTIL = '2099-01-01T10:00:00+02:00'; // or say the zone yourself
    expect(demo.status().until.toISOString()).toBe('2099-01-01T08:00:00.000Z');
    const user = await makeUser();
    expect((await codePageFor(user)).page.text).toContain('Your code is ' + lastCodeForTests(user.id));
  });

  test('it switches itself off when the end time passes', async () => {
    process.env.DEMO_SHOW_CODES_UNTIL = '2026-11-10 18:00';
    const before = new Date('2026-11-10T16:59:00Z'); // 17:59 in Lagos
    const after = new Date('2026-11-10T17:00:00Z'); // 18:00 in Lagos
    expect(demo.status(before).on).toBe(true);
    expect(demo.status(after)).toMatchObject({ on: false, reason: 'the end time has passed' });
    expect(demo.allowedFor({ role: 'senior', phone: '+2348031112222' }, after)).toBe(false);

    // and for real, with an end time already behind us
    process.env.DEMO_SHOW_CODES_UNTIL = '2020-01-01 10:00';
    const user = await makeUser();
    expect((await codePageFor(user)).page.text).not.toContain('data-shown-code');
  });

  test('an end time nobody can read is treated as off, not as "no limit"', () => {
    for (const bad of ['tomorrow', '10/11/2026', 'soon', '2026-13-45 10:00']) {
      process.env.DEMO_SHOW_CODES_UNTIL = bad;
      expect(demo.status()).toMatchObject({ on: false, reason: 'DEMO_SHOW_CODES_UNTIL cannot be read' });
    }
  });

  test('being told Render is production does not depend on NODE_ENV', () => {
    delete process.env.RENDER;
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(demo.status().on).toBe(false); // production, no end time
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});

describe('the warning on start-up', () => {
  test('it says when codes are shown and when they stop, and says nothing when off', () => {
    expect(demo.warning()).toBeNull();
    process.env.DEMO_SHOW_CODES = 'true';
    expect(demo.warning()).toContain('being shown on the screen');
    process.env.RENDER = 'true';
    expect(demo.warning()).toContain('NOT shown'); // switched on but no end time on the live site
    process.env.DEMO_SHOW_CODES_UNTIL = FUTURE;
    expect(demo.warning()).toContain('until 2099-01-01');
    process.env.DEMO_ACCOUNTS = '08031112222';
    expect(demo.warning()).toContain('1 listed account');
  });
});
