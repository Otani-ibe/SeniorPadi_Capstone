const request = require('supertest');
const app = require('../src/app');
const { Event, Registration, Attendance } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const HOUR = 60 * 60 * 1000;

async function staff() {
  const admin = await makeUser({ role: 'admin' });
  const agent = request.agent(app);
  await signIn(agent, admin.phone);
  return agent;
}

// an event happening in 2 hours, one guest, and the link staff made for it
async function setUp(eventExtra = {}) {
  const event = await makeEvent({ startsAt: new Date(Date.now() + 2 * HOUR), endsAt: new Date(Date.now() + 4 * HOUR), registrationDeadline: new Date(Date.now() + HOUR), ...eventExtra });
  const senior = await makeUser({ fullName: 'Mama Tolu', phone: '+2348031234567' });
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });
  const agent = await staff();
  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  expect(page.text).toContain('Make check-in link');
  await agent.post('/admin/events/' + event.id + '/checkin-link').type('form').send({ _csrf: csrfFrom(page.text) });
  await event.reload();
  return { event, reg, agent, link: '/checkin/' + event.checkinToken };
}

test('staff make a link; the organization opens it with no account and sees the guest list, phone numbers hidden', async () => {
  const { event, agent, link } = await setUp();
  expect(event.checkinToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

  const staffPage = await agent.get('/admin/events/' + event.id + '/attendance');
  expect(staffPage.text).toContain(link);
  expect(staffPage.text).toContain('Send on WhatsApp');

  const host = await request(app).get(link);
  expect(host.status).toBe(200);
  expect(host.text).toContain('Mama Tolu');
  expect(host.text).toContain('••• 4567');
  expect(host.text).not.toContain('08031234567');
  expect(host.text).not.toContain('/admin/seniors/');
  expect(host.text).toContain('noindex');
});

test('the organization ticks a guest; it is recorded as done by the organization', async () => {
  const { reg, link } = await setUp();
  const host = request.agent(app);
  const page = await host.get(link);
  const res = await host.post(link + '/registrations/' + reg.id + '/status').set('X-Requested-With', 'fetch').type('form')
    .send({ _csrf: csrfFrom(page.text), status: 'attended' });
  expect(res.body.counts.came).toBe(1);
  expect((await reg.reload()).status).toBe('attended');
  expect((await Attendance.findOne({ where: { registrationId: reg.id } })).method).toBe('host');

  const ticket = await host.post(link + '/checkin').type('form').send({ _csrf: csrfFrom(page.text), ticket: 'SP-NOPE00' });
  expect(ticket.headers.location).toBe(link);
});

test('a wrong, replaced or turned-off link does not open the list', async () => {
  const { event, agent, link } = await setUp();
  expect((await request(app).get('/checkin/not-a-real-link-at-all-123')).status).toBe(404);

  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/checkin-link').type('form').send({ _csrf: csrfFrom(page.text) }); // a new one
  const old = await request(app).get(link);
  expect(old.status).toBe(404);
  expect(old.text).toContain("This link isn't working");

  await event.reload();
  await agent.post('/admin/events/' + event.id + '/checkin-link/off').type('form').send({ _csrf: csrfFrom(page.text) });
  expect((await request(app).get('/checkin/' + event.checkinToken)).status).toBe(404);
});

test('the link opens the day before the event and closes 3 days after it', async () => {
  const { event, link } = await setUp();
  await Event.update({ startsAt: new Date(Date.now() + 3 * 24 * HOUR), endsAt: new Date(Date.now() + 3 * 24 * HOUR + HOUR) }, { where: { id: event.id } });
  const early = await request(app).get(link);
  expect(early.status).toBe(403);
  expect(early.text).toContain("isn't open yet");

  await Event.update({ startsAt: new Date(Date.now() - 5 * 24 * HOUR), endsAt: new Date(Date.now() - 4 * 24 * HOUR) }, { where: { id: event.id } });
  const late = await request(app).get(link);
  expect(late.status).toBe(403);
  expect(late.text).toContain('has closed');
});

test('a guest\'s QR code works for the organization on the phone with the link open, and for nobody else', async () => {
  const { reg, link } = await setUp();
  // a stranger scanning it is sent to log in, as before
  expect((await request(app).get('/admin/scan/' + reg.qrToken)).headers.location).toBe('/login');

  const host = request.agent(app);
  await host.get(link);
  const scan = await host.get('/admin/scan/' + reg.qrToken);
  expect(scan.status).toBe(200);
  expect(scan.text).toContain('Mama Tolu');
  await host.post('/admin/scan/' + reg.qrToken).type('form').send({ _csrf: csrfFrom(scan.text) });
  expect((await reg.reload()).status).toBe('attended');
});
