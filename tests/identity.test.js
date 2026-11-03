// NIN verification: a senior sends their NIN, it is saved encrypted, and only the superadmin can open it and decide.
// No test calls the internet.
process.env.NIN_ENCRYPTION_KEY = 'test-only-key-0123456789-abcdefghijklmnopqrstuvwxyz';

const http = require('http');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { io: connectClient } = require('socket.io-client');
const app = require('../src/app');
const setupSockets = require('../src/sockets');
const { User, IdentityVerification, Notification, AuditLog, Message } = require('../src/models');
const notifier = require('../src/services/notify');
const identity = require('../src/services/identity');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize } = require('./helpers');

const KEY = process.env.NIN_ENCRYPTION_KEY;
beforeEach(resetDb);
afterEach(() => {
  process.env.NIN_ENCRYPTION_KEY = KEY;
  jest.restoreAllMocks();
});
afterAll(() => sequelize.close());

const NIN = '70123456789';
const seniorAccount = (extra = {}) => makeUser({ fullName: 'Mama Tolu Adeyemi', phone: '+2348031112222', ...extra });
const superAdmin = () => makeUser({ role: 'admin', isSuperAdmin: true, fullName: 'Otani Ibe', phone: '+2348070000001' });
const regularAdmin = () => makeUser({ role: 'admin', fullName: 'Other Admin', phone: '+2348070000002' });

async function agentFor(user) {
  const agent = request.agent(app);
  await signIn(agent, user.phone);
  return agent;
}

// a CSRF token from any page that has a form
async function tokenFor(agent) {
  for (const url of ['/admin/ids', '/identity', '/events', '/']) {
    const token = csrfFrom((await agent.get(url)).text || '');
    if (token) return token;
  }
  throw new Error('no csrf token found');
}

async function submit(agent, fields = {}) {
  const token = await tokenFor(agent);
  return agent.post('/identity').type('form').send({ _csrf: token, nin: NIN, consent: 'yes', ...fields });
}

// a senior who has sent their NIN, and is waiting
async function waitingSenior(extra = {}, nin = NIN) {
  const senior = await seniorAccount(extra);
  await submit(await agentFor(senior), { nin });
  expect((await senior.reload()).verificationStatus).toBe('pending');
  return senior;
}

// what the superadmin presses
async function decide(admin, senior, outcome, reason) {
  const token = await tokenFor(admin);
  return admin.post('/admin/ids/' + senior.id + '/decide').type('form').send({ _csrf: token, outcome, reason });
}

describe('before verifying', () => {
  test('signing up asks for no NIN, and the new account is not verified', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/signup');
    expect(page.text).not.toMatch(/\bNIN\b/i);
    expect(page.text).not.toContain('name="nin"');
    const res = await agent.post('/signup').type('form').send({
      _csrf: csrfFrom(page.text), fullName: 'New Person', phone: '0805 600 1234', lga: 'ibadan-north', ageDeclared: 'yes'
    });
    expect(res.headers.location).toBe('/login/code');
    expect((await User.findOne({ where: { fullName: 'New Person' } })).verificationStatus).toBe('unverified');
    expect(await IdentityVerification.count()).toBe(0);
  });

  test('a basic account can use public events, its profile and its account', async () => {
    const user = await makeUser();
    const event = await makeEvent();
    const agent = await agentFor(user);
    for (const url of ['/', '/events', '/events/' + event.id, '/account', '/settings', '/registrations']) {
      expect((await agent.get(url)).status).toBe(200);
    }
    expect((await request(app).get('/events')).status).toBe(200); // and a visitor can see events too
  });

  test('Find Seniors sends an unverified senior to the verification page, which explains and asks for the NIN', async () => {
    const agent = await agentFor(await makeUser());
    const res = await agent.get('/find-seniors');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/identity');

    const page = await agent.get('/identity');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Find Seniors is only for verified seniors aged 50 and above.');
    expect(page.text).toContain('name="nin"');
    expect(page.text).toContain('11 numbers');
    expect(page.text).toContain('NIMC');
    expect(page.text).toContain('delete it after we check it');
    expect(page.text).toMatch(/name="consent"[^>]*required/);
    expect(page.text).not.toMatch(/encrypt/i); // no words a senior would not know
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.text).not.toMatch(/dojah/i); // no outside company is involved
  });
});

describe('what is sent is checked first', () => {
  test.each([['123'], ['1234567890'], ['123456789012'], ['abcdefghijk'], ['7012345678a'], ['']])('"%s" is not a NIN, and nothing is saved', async (bad) => {
    const user = await seniorAccount();
    const res = await submit(await agentFor(user), { nin: bad });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please type all 11 numbers of your NIN.');
    if (bad) expect(res.text).not.toContain('value="' + bad); // never put back in the form
    expect((await user.reload()).verificationStatus).toBe('unverified');
    expect(await IdentityVerification.count()).toBe(0);
  });

  test('the NIN box takes 11 numbers only: the page limits it, and the server refuses anything else', async () => {
    const page = await (await agentFor(await makeUser())).get('/identity');
    const input = page.text.match(/<input[^>]*name="nin"[^>]*>/)[0];
    expect(input).toContain('maxlength="11"'); // no twelfth number can be typed
    expect(input).toContain('minlength="11"');
    expect(input).toContain('pattern="[0-9]{11}"'); // numbers only
    expect(input).toContain('inputmode="numeric"');
    expect(page.text).toContain('/js/nin-input.js'); // drops letters, cleans a pasted number, shows "7 of 11"
    // and whatever a script or an old page sends, the server accepts exactly 11 numbers
    expect(identity.normalizeNin('701234567890')).toBeNull(); // 12
    expect(identity.normalizeNin('7012345678')).toBeNull(); // 10
    expect(identity.normalizeNin('70123456789 0')).toBeNull();
    expect(identity.normalizeNin('7012345678a')).toBeNull();
    expect(identity.normalizeNin('70123456789')).toBe('70123456789');
  });

  test('spaces and dashes are allowed: 701 2345 6789 and 701-2345-6789 are the same NIN', () => {
    expect(identity.normalizeNin('701 2345 6789')).toBe(NIN);
    expect(identity.normalizeNin('701-2345-6789')).toBe(NIN);
    expect(identity.normalizeNin(null)).toBeNull();
  });

  test('without the tick for consent, nothing is saved', async () => {
    const user = await seniorAccount();
    const res = await submit(await agentFor(user), { consent: undefined });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please tick the box to continue.');
    expect((await user.reload()).verificationStatus).toBe('unverified');
    expect(await IdentityVerification.count()).toBe(0);
  });

  test('with no encryption key set, nothing is accepted and nothing is saved (never stored unlocked)', async () => {
    delete process.env.NIN_ENCRYPTION_KEY;
    const user = await seniorAccount();
    const res = await submit(await agentFor(user));
    expect(res.status).toBe(400);
    expect(res.text).toContain('cannot take your NIN right now');
    expect((await user.reload()).verificationStatus).toBe('unverified');
    expect(await IdentityVerification.count()).toBe(0);
  });
});

describe('sending a NIN', () => {
  test('it is saved encrypted, the senior waits, and the superadmin (only) is told', async () => {
    const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
    const boss = await superAdmin();
    const other = await regularAdmin();
    const senior = await seniorAccount();
    const agent = await agentFor(senior);
    const res = await submit(agent);
    expect(res.headers.location).toBe('/identity/status');

    expect((await senior.reload()).verificationStatus).toBe('pending');
    const row = await IdentityVerification.findOne({ where: { userId: senior.id } });
    expect(row.status).toBe('submitted');
    expect(row.encryptedNin).toMatch(/^v1:/);
    expect(row.encryptedNin).not.toContain(NIN);
    expect(row.ninHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.consentAt).toBeTruthy();
    expect(row.submittedAt).toBeTruthy();
    expect(row.completedAt).toBeNull();

    // the senior is told it arrived; only the superadmin is told one is waiting
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: senior.id }), 'identity.manual_review', expect.any(Object));
    expect(await Notification.count({ where: { userId: boss.id, type: 'admin.id_submitted' } })).toBe(1);
    expect(await Notification.count({ where: { userId: other.id, type: 'admin.id_submitted' } })).toBe(0);
    expect(await Notification.count({ where: { userId: senior.id, type: 'identity.manual_review' } })).toBe(1);
    expect(await AuditLog.count({ where: { action: 'identity.submitted', entityId: senior.id } })).toBe(1);

    const status = await agent.get('/identity/status');
    expect(status.text).toContain('We are checking your NIN');
    expect((await agent.get('/find-seniors')).headers.location).toBe('/identity');
  });

  test('while it waits they cannot send another, and events keep working', async () => {
    const senior = await waitingSenior();
    const agent = await agentFor(senior);
    expect((await agent.get('/identity')).headers.location).toBe('/identity/status');
    expect((await submit(agent, { nin: '70123456780' })).headers.location).toBe('/identity/status');
    expect(await IdentityVerification.count()).toBe(1);
    expect((await agent.get('/events')).status).toBe(200);
  });

  test('two quick submissions make one', async () => {
    const user = await seniorAccount();
    const [a, b] = await Promise.all([
      identity.submitNin(await User.findByPk(user.id), NIN, { consent: true }),
      identity.submitNin(await User.findByPk(user.id), NIN, { consent: true })
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await IdentityVerification.count()).toBe(1);
  });

  test('it is never in a table, a page, a notice, the audit log or a log line, except encrypted', async () => {
    const logs = ['log', 'error', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    await superAdmin();
    const senior = await seniorAccount();
    const agent = await agentFor(senior);
    const res = await submit(agent);
    const pages = [res.text, res.headers.location, (await agent.get('/identity/status')).text, (await agent.get('/account')).text, (await agent.get('/notifications')).text];

    const stored = JSON.stringify([
      (await IdentityVerification.findAll({ raw: true })).map((r) => ({ ...r, encryptedNin: undefined })),
      await User.findAll({ raw: true, paranoid: false }),
      await Notification.findAll({ raw: true }),
      await AuditLog.findAll({ raw: true })
    ]);
    expect(stored).not.toContain(NIN);
    for (const page of pages) expect(page || '').not.toContain(NIN);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(NIN);
  });

  test('after 3 declines they are asked to call, and no more are saved', async () => {
    const boss = await agentFor(await superAdmin());
    const senior = await seniorAccount();
    const agent = await agentFor(senior);
    for (let i = 0; i < 3; i++) {
      await submit(agent, { nin: '7012345678' + i });
      await decide(boss, senior, 'rejected', 'Does not match');
    }
    const res = await submit(agent);
    expect(res.status).toBe(400);
    expect(res.text).toContain('call SeniorPadi');
    expect(await IdentityVerification.count()).toBe(3);
  });
});

describe('the encryption', () => {
  test('a NIN comes back exactly, and the same NIN never looks the same twice', () => {
    const a = identity.encryptNin(NIN, 7);
    const b = identity.encryptNin(NIN, 7);
    expect(a).not.toBe(b); // a fresh random IV each time
    expect(identity.decryptNin(a, 7)).toBe(NIN);
    expect(identity.decryptNin(b, 7)).toBe(NIN);
  });

  test('it cannot be read with the wrong key, moved to another account, or tampered with', () => {
    const stored = identity.encryptNin(NIN, 7);
    expect(identity.decryptNin(stored, 8)).toBeNull(); // another account
    const bytes = Buffer.from(stored.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(identity.decryptNin('v1:' + bytes.toString('base64'), 7)).toBeNull(); // changed
    expect(identity.decryptNin('v1:not-base64-at-all', 7)).toBeNull();
    expect(identity.decryptNin(null, 7)).toBeNull();
    expect(identity.decryptNin('plain text', 7)).toBeNull();
    process.env.NIN_ENCRYPTION_KEY = 'a-completely-different-key-0123456789-abcdef';
    expect(identity.decryptNin(stored, 7)).toBeNull(); // another key
  });

  test('without a key of at least 32 characters it refuses to lock anything', () => {
    for (const bad of [undefined, '', 'too-short']) {
      if (bad === undefined) delete process.env.NIN_ENCRYPTION_KEY; else process.env.NIN_ENCRYPTION_KEY = bad;
      expect(identity.isConfigured()).toBe(false);
      expect(() => identity.encryptNin(NIN, 1)).toThrow();
      expect(() => identity.hashNin(NIN)).toThrow();
    }
  });

  test('the hash is not the NIN, is steady, and depends on the secret key', () => {
    const hash = identity.hashNin(NIN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(identity.hashNin(NIN));
    expect(identity.hashNin('70123456780')).not.toBe(hash);
    process.env.NIN_ENCRYPTION_KEY = 'a-completely-different-key-0123456789-abcdef';
    expect(identity.hashNin(NIN)).not.toBe(hash);
  });
});

describe('only the superadmin can open a NIN', () => {
  test('the queue lists who is waiting and never shows a NIN', async () => {
    const senior = await waitingSenior();
    const boss = await agentFor(await superAdmin());
    const page = await boss.get('/admin/ids');
    expect(page.status).toBe(200);
    expect(page.text).toContain(senior.fullName);
    expect(page.text).not.toContain(NIN);
    expect(page.text).toContain('Check NIN');
  });

  test('other admins, seniors and visitors cannot see the queue, open a NIN, or decide', async () => {
    const senior = await waitingSenior();
    const intruders = [await agentFor(await regularAdmin()), await agentFor(await seniorAccount({ phone: '+2348039990000' }))];
    for (const agent of intruders) {
      const token = await tokenFor(agent);
      expect((await agent.get('/admin/ids')).status).toBe(403);
      const show = await agent.post('/admin/ids/' + senior.id + '/show').type('form').send({ _csrf: token });
      expect(show.status).toBe(403);
      expect(show.text).not.toContain(NIN);
      expect((await agent.post('/admin/ids/' + senior.id + '/decide').type('form').send({ _csrf: token, outcome: 'verified' })).status).toBe(403);
    }
    expect((await request(app).get('/admin/ids')).status).toBe(302); // a visitor is sent to log in
    expect((await senior.reload()).verificationStatus).toBe('pending');
    expect(await AuditLog.count({ where: { action: 'identity.nin_viewed' } })).toBe(0);
  });

  test('the dashboard count and the menu entry are for the superadmin only', async () => {
    await waitingSenior();
    const boss = await agentFor(await superAdmin());
    const other = await agentFor(await regularAdmin());
    expect((await boss.get('/admin')).text).toContain('Identity checks');
    expect((await boss.get('/admin/seniors')).text).toContain('Identity checks');
    expect((await other.get('/admin')).text).not.toContain('Identity checks');
    expect((await other.get('/admin/seniors')).text).not.toContain('Identity checks');
    expect((await other.get('/admin/seniors')).status).toBe(200); // everything else works as before
  });

  test('"Show NIN" reveals it to the superadmin, once per press, and the audit log says who looked (never the number)', async () => {
    const senior = await waitingSenior();
    const boss = await superAdmin();
    const agent = await agentFor(boss);
    const token = await tokenFor(agent);
    const page = await agent.post('/admin/ids/' + senior.id + '/show').type('form').send({ _csrf: token });
    expect(page.status).toBe(200);
    expect(page.text).toContain(NIN);
    expect(page.text).toContain('NIMC');
    expect(page.headers['cache-control']).toBe('no-store');

    const entries = await AuditLog.findAll({ where: { action: 'identity.nin_viewed' }, raw: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: boss.id, entityId: senior.id });
    expect(JSON.stringify(entries)).not.toContain(NIN);
    expect((await agent.get('/admin/ids/' + senior.id + '/show')).status).toBe(404); // it is a button, never an address
  });
});

describe('the superadmin decides', () => {
  test('verified: they can use Find Seniors, are told, and the NIN is erased on the spot', async () => {
    const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
    const senior = await waitingSenior();
    const boss = await superAdmin();
    const agent = await agentFor(boss);
    const res = await decide(agent, senior, 'verified');
    expect(res.headers.location).toBe('/admin/ids');

    expect((await senior.reload()).verificationStatus).toBe('approved');
    const row = await IdentityVerification.findOne({ where: { userId: senior.id } });
    expect(row).toMatchObject({ status: 'verified', encryptedNin: null, reviewedByAdminId: boss.id });
    expect(row.ninHash).toMatch(/^[0-9a-f]{64}$/); // kept only to stop one NIN verifying two accounts
    expect(row.completedAt).toBeTruthy();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: senior.id }), 'identity.verified', expect.any(Object));
    expect((await Notification.findOne({ where: { userId: senior.id, type: 'identity.verified' } })).link).toBe('/find-seniors');
    expect(await AuditLog.count({ where: { action: 'identity.verified', entityId: senior.id } })).toBe(1);

    const theirs = await agentFor(senior);
    expect((await theirs.get('/find-seniors')).status).toBe(200);
    expect((await theirs.get('/identity/status')).text).toContain('You are verified');
    expect((await agent.get('/admin/ids')).text).not.toContain('Check NIN'); // off the queue
  });

  test('under 50: not eligible, told so, events still work, the NIN and its hash are erased', async () => {
    const senior = await waitingSenior();
    const agent = await agentFor(await superAdmin());
    await decide(agent, senior, 'not_eligible');
    expect((await senior.reload()).verificationStatus).toBe('not_eligible');
    expect(await IdentityVerification.findOne({ where: { userId: senior.id } })).toMatchObject({ status: 'not_eligible', encryptedNin: null, ninHash: null });
    const theirs = await agentFor(senior);
    const status = await theirs.get('/identity/status');
    expect(status.text).toContain('Find Seniors is for people aged 50 and over');
    expect(status.text).not.toContain('href="/identity"'); // no way to try again
    expect((await theirs.get('/find-seniors')).headers.location).toBe('/identity');
    expect((await theirs.get('/events')).status).toBe(200);
    expect(await Notification.count({ where: { userId: senior.id, type: 'identity.not_eligible' } })).toBe(1);
  });

  test('declined: a reason is required, the senior sees it, the NIN is erased, and they can send a corrected one', async () => {
    const senior = await waitingSenior();
    const event = await makeEvent();
    const agent = await agentFor(await superAdmin());

    await decide(agent, senior, 'rejected', '   '); // no reason, no decision
    expect((await senior.reload()).verificationStatus).toBe('pending');
    expect(await IdentityVerification.count({ where: { status: 'submitted' } })).toBe(1);

    await decide(agent, senior, 'rejected', 'The name on the NIN does not match this account');
    expect((await senior.reload()).verificationStatus).toBe('rejected');
    expect(await IdentityVerification.findOne({ where: { userId: senior.id } })).toMatchObject({ status: 'rejected', encryptedNin: null, ninHash: null, decisionNote: 'The name on the NIN does not match this account' });

    const theirs = await agentFor(senior);
    expect((await theirs.get('/identity/status')).text).toContain('The name on the NIN does not match this account');
    const form = await theirs.get('/identity');
    expect(form.status).toBe(200);
    expect(form.text).toContain('The name on the NIN does not match this account');
    const eventPage = await theirs.get('/events/' + event.id);
    expect((await theirs.post('/events/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(eventPage.text) })).headers.location).toMatch(/registered/);

    await submit(theirs, { nin: '70123456780' }); // corrected
    expect((await senior.reload()).verificationStatus).toBe('pending');
    expect(await IdentityVerification.count({ where: { status: 'submitted' } })).toBe(1);
  });

  test('one NIN, one verified account: a second account with the same NIN is flagged and cannot be verified', async () => {
    const first = await waitingSenior();
    const agent = await agentFor(await superAdmin());
    await decide(agent, first, 'verified');
    const second = await waitingSenior({ phone: '+2348039998888' });

    const queue = await agent.get('/admin/ids');
    expect(queue.text).toContain('already verified on another account');
    const token = await tokenFor(agent);
    const review = await agent.post('/admin/ids/' + second.id + '/show').type('form').send({ _csrf: token });
    expect(review.text).toContain('cannot be verified a second time');
    expect(review.text).not.toContain('data-decision="verified"'); // the button is not even offered

    await decide(agent, second, 'verified'); // and if it is forced anyway, the database refuses
    expect((await second.reload()).verificationStatus).toBe('pending');
    expect(await IdentityVerification.count({ where: { status: 'verified' } })).toBe(1);
    await decide(agent, second, 'rejected', 'This NIN belongs to another account');
    expect((await second.reload()).verificationStatus).toBe('rejected');
  });

  test('a NIN that can no longer be read (the key was changed) is declined, not guessed', async () => {
    const senior = await waitingSenior();
    const agent = await agentFor(await superAdmin());
    process.env.NIN_ENCRYPTION_KEY = 'a-completely-different-key-0123456789-abcdef';
    const token = await tokenFor(agent);
    const review = await agent.post('/admin/ids/' + senior.id + '/show').type('form').send({ _csrf: token });
    expect(review.text).toContain('can no longer be read');
    expect(review.text).not.toContain('data-decision="verified"');
    await decide(agent, senior, 'rejected', 'Please send your NIN again');
    expect((await senior.reload()).verificationStatus).toBe('rejected');
  });

  test('deciding something that is not waiting, or choosing nothing, changes nothing', async () => {
    const senior = await waitingSenior();
    const agent = await agentFor(await superAdmin());
    await decide(agent, senior, 'banana');
    expect((await senior.reload()).verificationStatus).toBe('pending');
    await decide(agent, senior, 'verified');
    const again = await decide(agent, senior, 'rejected', 'late');
    expect(again.headers.location).toBe('/admin/ids');
    expect((await senior.reload()).verificationStatus).toBe('approved');
    expect(await IdentityVerification.count({ where: { status: 'rejected' } })).toBe(0);
  });

  test('after any decision no NIN is left anywhere in the database', async () => {
    const agent = await agentFor(await superAdmin());
    for (const [i, outcome] of [['0', 'verified'], ['1', 'not_eligible'], ['2', 'rejected']]) {
      const senior = await waitingSenior({ phone: '+234803000000' + i }, '7012345678' + i);
      await decide(agent, senior, outcome, 'because');
    }
    expect(await IdentityVerification.count({ where: { encryptedNin: { [require('sequelize').Op.ne]: null } } })).toBe(0);
    const everything = JSON.stringify([await IdentityVerification.findAll({ raw: true }), await Notification.findAll({ raw: true }), await AuditLog.findAll({ raw: true })]);
    for (const n of ['70123456780', '70123456781', '70123456782']) expect(everything).not.toContain(n);
  });
});

describe('the verification rules cannot be bypassed', () => {
  const restricted = (other) => [
    ['get', '/find-seniors'],
    ['get', '/find-seniors/skipped'],
    ['post', '/find-seniors/' + other + '/skip'],
    ['post', '/find-seniors/' + other + '/unskip'],
    ['get', '/seniors/' + other],
    ['get', '/messages'],
    ['get', '/messages/' + other],
    ['post', '/messages/' + other],
    ['post', '/messages/' + other + '/exchange'],
    ['get', '/report/' + other],
    ['post', '/report/' + other],
    ['get', '/block/' + other],
    ['post', '/block/' + other]
  ];

  test.each(['unverified', 'pending', 'not_eligible', 'rejected'])('a "%s" account that types the address is sent to verification', async (status) => {
    const other = await makeUser({ verificationStatus: 'approved' });
    const user = await makeUser({ verificationStatus: status });
    const agent = await agentFor(user);
    const page = await agent.get('/events');
    for (const [method, url] of restricted(other.id)) {
      const res = method === 'get' ? await agent.get(url) : await agent.post(url).type('form').send({ _csrf: csrfFrom(page.text), body: 'hello' });
      expect([method, url, res.status, res.headers.location]).toEqual([method, url, 302, '/identity']);
    }
    expect(await Message.count()).toBe(0);
    expect((await agent.get('/calls/ice')).status).toBe(403);
  });

  test('a visitor who is not signed in is sent to log in, and a staff account to its own area', async () => {
    const other = await makeUser({ verificationStatus: 'approved' });
    for (const [method, url] of restricted(other.id).filter(([m, u]) => m === 'get' && u !== '/find-seniors')) {
      expect([url, (await request(app).get(url)).headers.location]).toEqual([url, '/login']);
    }
    const admin = await makeUser({ role: 'admin' });
    expect((await (await agentFor(admin)).get('/messages')).headers.location).toBe('/admin');
  });

  test('a real-time connection is refused too (chat and calls are not just hidden links)', async () => {
    const server = http.createServer(app);
    const io = setupSockets(server);
    await new Promise((r) => server.listen(0, r));
    try {
      const user = await makeUser({ verificationStatus: 'pending' });
      const agent = request.agent(server);
      const login = await agent.get('/login');
      const cookie = login.headers['set-cookie'][0].split(';')[0];
      await signIn(agent, user.phone);
      const csrf = csrfFrom((await agent.get('/events')).text);
      const socket = connectClient('http://localhost:' + server.address().port, { auth: { csrf }, extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
      const connected = await new Promise((resolve) => { socket.on('connect', () => resolve(true)); socket.on('connect_error', () => resolve(false)); });
      expect(connected).toBe(false);
      socket.close();
    } finally {
      io.close();
      server.close();
    }
  });

  test('a verified senior, and the demo seniors who were already approved, keep full access', async () => {
    const demo = await makeUser({ verificationStatus: 'approved' }); // how every seeded demo senior is stored
    const agent = await agentFor(demo);
    expect((await agent.get('/find-seniors')).status).toBe(200);
    expect((await agent.get('/messages')).status).toBe(200);
    expect((await agent.get('/identity')).headers.location).toBe('/find-seniors'); // nothing to verify
  });

  test('someone removed from Find Seniors is told so, not asked to verify', async () => {
    const removed = await makeUser({ verificationStatus: 'social_removed' });
    const agent = await agentFor(removed);
    const page = await agent.get('/find-seniors');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/use Find Seniors or messages anymore/);
    expect((await agent.get('/messages')).headers.location).toBe('/find-seniors');
  });

  test('there is no way left to upload an ID photo', async () => {
    const user = await makeUser();
    const agent = await agentFor(user);
    const page = await agent.get('/events');
    const res = await agent.post('/find-seniors/id').type('form').send({ _csrf: csrfFrom(page.text) });
    expect(res.status).toBe(404);
    expect((await agent.get('/identity')).text).not.toContain('type="file"');
  });

  test('staff and visitors cannot use the senior verification pages', async () => {
    expect((await request(app).get('/identity')).headers.location).toBe('/login');
    expect((await request(app).get('/identity/status')).headers.location).toBe('/login');
    const admin = await makeUser({ role: 'admin' });
    expect((await (await agentFor(admin)).get('/identity')).headers.location).toBe('/admin');
  });
});

describe('words, in English and Yorùbá', () => {
  test.each(['verified', 'not_eligible', 'review_rejected', 'manual_review'])('%s: text, email and in-app notice', (outcome) => {
    for (const lang of ['en', 'yo']) {
      for (const key of ['identity.' + outcome + '.sms', 'identity.' + outcome + '.subject', 'identity.' + outcome + '.email', 'notification.identity.' + outcome]) {
        const text = t(key, lang, { name: 'Tolu', reason: 'why' });
        expect([key, text.startsWith(key)]).toEqual([key, false]); // not the key itself: it exists
      }
    }
  });

  test('the status page has words for every state, and each state renders', async () => {
    const user = await makeUser();
    const agent = await agentFor(user);
    for (const status of ['unverified', 'pending', 'not_eligible', 'rejected', 'approved', 'social_removed']) {
      await user.update({ verificationStatus: status });
      const res = await agent.get('/identity/status');
      expect([status, res.status]).toEqual([status, 200]);
      expect(res.text).not.toMatch(/identity\.state\./);
    }
    for (const key of ['not_started', 'pending', 'verified', 'not_eligible', 'review_rejected', 'removed']) {
      for (const lang of ['en', 'yo']) expect(t('identity.state.' + key + '.title', lang)).not.toMatch(/^identity\.state/);
    }
  });

  test('no outside company is named anywhere in the app', () => {
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full); else if (/\.(js|ejs|json)$/.test(e.name) && !/migrations/.test(full)) files.push(full);
    });
    ['src', 'views', 'locales', 'public/js'].forEach((d) => walk(path.join(__dirname, '..', d)));
    const mentions = files.filter((f) => /dojah/i.test(fs.readFileSync(f, 'utf8')));
    expect(mentions).toEqual([]);
  });
});


describe('the staff screens', () => {
  test('the review screen has one reason box and three equal buttons, in the same style as the rest of the staff area', async () => {
    const senior = await waitingSenior();
    const agent = await agentFor(await superAdmin());
    const token = await tokenFor(agent);
    const page = await agent.post('/admin/ids/' + senior.id + '/show').type('form').send({ _csrf: token });
    const buttons = [...page.text.matchAll(/<button name="outcome" value="(\w+)"[^>]*class="([^"]*)"/g)].map((m) => [m[1], m[2].split(' ')[0]]);
    expect(buttons).toEqual([['verified', 'abtn'], ['not_eligible', 'abtn-soft'], ['rejected', 'abtn-danger']]);
    expect((page.text.match(/<form action="\/admin\/ids\/\d+\/decide"/g) || [])).toHaveLength(1); // one form, not three
    expect(page.text).not.toContain('btn-volunteer'); // the old green button is gone
  });

  test('the System page is gone, from the menu and from the address bar', async () => {
    const agent = await agentFor(await superAdmin());
    expect((await agent.get('/admin/system')).status).toBe(404);
    for (const url of ['/admin', '/admin/events', '/admin/seniors', '/admin/staff']) {
      const page = await agent.get(url);
      expect(page.status).toBe(200);
      expect(page.text).not.toMatch(/href="\/admin\/system"/);
      expect(page.text).not.toMatch(/setting\(s\)\s+need attention/);
    }
  });
});
