// The Call and WhatsApp buttons use SeniorPadi's own number and WhatsApp link.
const request = require('supertest');
const app = require('../src/app');
const { resetDb, makeUser, signIn, sequelize } = require('./helpers');

const NAMES = ['SUPPORT_PHONE', 'SUPPORT_WHATSAPP_URL'];
const saved = {};
beforeAll(() => NAMES.forEach((n) => { saved[n] = process.env[n]; }));
beforeEach(async () => { NAMES.forEach((n) => delete process.env[n]); await resetDb(); });
afterAll(async () => { NAMES.forEach((n) => { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }); await sequelize.close(); });

const PHONE = 'tel:+2348061761235';
const LINK = 'https://wa.link/lqmmfi';

test('the home page, footer and Call page use the number and the WhatsApp link', async () => {
  for (const url of ['/', '/call', '/about', '/events']) {
    const page = await request(app).get(url);
    expect([url, page.text.includes(PHONE)]).toEqual([url, true]);
    expect([url, page.text.includes(LINK)]).toEqual([url, true]);
  }
  expect((await request(app).get('/call')).text).toContain('0806 176 1235'); // read out the way people say it
});

test('a wa.link short link is used as it is: nothing is added to it, and no old number is left anywhere', async () => {
  const home = await request(app).get('/');
  expect(home.text).not.toMatch(/wa\.link\/lqmmfi\?/);
  expect(home.text).not.toContain('wa.me/');
  expect(home.text).not.toMatch(/0800 000 0000|tel:0800/);
});

test('signed-in seniors and the error page get the same details', async () => {
  const user = await makeUser();
  const agent = request.agent(app);
  await signIn(agent, user.phone);
  expect((await agent.get('/account')).text).toContain(PHONE);
  expect((await request(app).get('/no-such-page')).text).toContain(PHONE);
});

test('the settings can change them, and a wa.me link carries each message', async () => {
  process.env.SUPPORT_PHONE = '08031112222';
  process.env.SUPPORT_WHATSAPP_URL = 'https://wa.me/2348031112222';
  const home = await request(app).get('/');
  expect(home.text).toContain('tel:08031112222');
  expect(home.text).toContain('https://wa.me/2348031112222?text=');
  expect(home.text).not.toContain(LINK);
});
