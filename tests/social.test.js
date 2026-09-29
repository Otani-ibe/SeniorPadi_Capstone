// fake Cloudinary keys so signed links can be made (nothing is uploaded in tests)
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = '123';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const { User, Registration, ReportHide, Block, Message } = require('../src/models');
const social = require('../src/services/social');
const { removeFromSocial, deleteAccount } = require('../src/services/removal');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone, password: 'password123' });
  return agent;
}

function verified() {
  return makeUser({ verificationStatus: 'approved' });
}

test('unverified seniors cannot open or send messages', async () => {
  const me = await makeUser();
  const other = await verified();
  const agent = await loggedInAgent(me.phone);

  const page = await agent.get('/messages/' + other.id);
  expect(page.headers.location).toBe('/find-seniors');

  const home = await agent.get('/events');
  const send = await agent.post('/messages/' + other.id).type('form').send({ _csrf: csrfFrom(home.text), body: 'hi' });
  expect(send.headers.location).toBe('/find-seniors');
  expect(await Message.count()).toBe(0);
});

test('verified seniors can message each other with a plain form', async () => {
  const me = await verified();
  const other = await verified();
  const agent = await loggedInAgent(me.phone);

  const page = await agent.get('/messages/' + other.id);
  await agent.post('/messages/' + other.id).type('form').send({ _csrf: csrfFrom(page.text), body: 'Hello' });
  expect(await Message.count()).toBe(1);
});

test('report hides the reported senior from the reporter only', async () => {
  const reporter = await verified();
  const reported = await verified();
  const agent = await loggedInAgent(reporter.phone);

  const page = await agent.get('/report/' + reported.id);
  await agent.post('/report/' + reported.id).type('form').send({ _csrf: csrfFrom(page.text) });

  expect(await ReportHide.count()).toBe(1);
  expect(await social.nextSeniorFor(reporter)).toBeNull();
  // the reported senior still sees the reporter (they aren't punished before review)
  const theyStillSee = await social.nextSeniorFor(reported);
  expect(theyStillSee.id).toBe(reporter.id);
  // but messages stop both ways
  expect(await social.canMessage(reported, reporter)).toBe(false);
});

test('a block stops messages in both directions', async () => {
  const a = await verified();
  const b = await verified();
  await Block.create({ blockerId: a.id, blockedId: b.id });

  expect(await social.canMessage(a, b)).toBe(false);
  expect(await social.canMessage(b, a)).toBe(false);

  const agent = await loggedInAgent(b.phone);
  const home = await agent.get('/events');
  const res = await agent.post('/messages/' + a.id).type('form').send({ _csrf: csrfFrom(home.text), body: 'hi' });
  expect(res.status).toBe(403);
});

test('skipped seniors do not come back', async () => {
  const me = await verified();
  const other = await verified();
  const agent = await loggedInAgent(me.phone);

  const page = await agent.get('/find-seniors');
  await agent.post('/find-seniors/' + other.id + '/skip').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(await social.nextSeniorFor(me)).toBeNull();
});

test('removing from the social layer does not touch registrations', async () => {
  const senior = await verified();
  const event = await makeEvent();
  await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });

  await removeFromSocial(senior, null);

  const reg = await Registration.findOne({ where: { seniorId: senior.id } });
  expect(reg.status).toBe('registered');
  expect(senior.verificationStatus).toBe('social_removed');
  expect(await User.findByPk(senior.id)).not.toBeNull(); // not deleted
});

test('deleting an account cancels only upcoming registrations', async () => {
  const senior = await makeUser();
  const future = await makeEvent();
  const past = await makeEvent({
    startsAt: new Date(Date.now() - 3 * DAY),
    endsAt: new Date(Date.now() - 3 * DAY + 3600000),
    registrationDeadline: new Date(Date.now() - 4 * DAY)
  });
  const upcoming = await Registration.create({ eventId: future.id, seniorId: senior.id, type: 'attendee' });
  const attended = await Registration.create({ eventId: past.id, seniorId: senior.id, type: 'attendee', status: 'attended' });

  await deleteAccount(senior, senior.id);

  expect((await upcoming.reload()).status).toBe('cancelled');
  expect((await attended.reload()).status).toBe('attended');
  expect(await User.findByPk(senior.id)).toBeNull(); // hidden by paranoid
  expect(await User.findByPk(senior.id, { paranoid: false })).not.toBeNull(); // row still there
});

test('ID documents can only be opened by admins, through a short-lived signed link', async () => {
  const senior = await makeUser({ verificationStatus: 'pending', idDocumentPublicId: 'seniorpadi/private/ids/abc', idDocumentFormat: 'jpg' });
  const admin = await makeUser({ role: 'admin' });

  const seniorAgent = await loggedInAgent(senior.phone);
  expect((await seniorAgent.get('/admin/ids/' + senior.id + '/view')).status).toBe(403);

  const adminAgent = await loggedInAgent(admin.phone);
  const res = await adminAgent.get('/admin/ids/' + senior.id + '/view');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/api\.cloudinary\.com/);
  expect(res.headers.location).toMatch(/expires_at=/);
  expect(res.headers['cache-control']).toBe('no-store');

  // the ID link never appears on senior pages
  const settings = await seniorAgent.get('/find-seniors');
  expect(settings.text).not.toMatch(/private\/ids/);
});

test('rejecting an ID keeps event access', async () => {
  const senior = await makeUser({ verificationStatus: 'pending', idDocumentPublicId: 'x', idDocumentFormat: 'jpg' });
  const admin = await makeUser({ role: 'admin' });
  const event = await makeEvent();
  const agent = await loggedInAgent(admin.phone);

  const page = await agent.get('/admin/ids');
  await agent.post('/admin/ids/' + senior.id + '/reject').type('form').send({ _csrf: csrfFrom(page.text), reason: 'Blurry photo' });
  await senior.reload();
  expect(senior.verificationStatus).toBe('rejected');

  const seniorAgent = await loggedInAgent(senior.phone);
  const eventPage = await seniorAgent.get('/events/' + event.id);
  const reg = await seniorAgent.post('/events/' + event.id + '/register').type('form').send({ _csrf: csrfFrom(eventPage.text) });
  expect(reg.headers.location).toMatch(/confirmed/);
});
