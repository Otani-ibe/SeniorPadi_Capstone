const request = require('supertest');
const app = require('../src/app');
const { Organization, Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, signIn } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function staff() {
  const admin = await makeUser({ role: 'admin', fullName: 'Staff Person' });
  const agent = request.agent(app);
  await signIn(agent, admin.phone);
  return agent;
}

test('events: each card shows the details, and the picture opens the edit page', async () => {
  const event = await makeEvent({ title: 'Morning walk', area: 'egbeda' });
  const page = await (await staff()).get('/admin/events');
  expect(page.text).toContain('Morning walk');
  expect(page.text).toContain('Egbeda');
  expect(page.text).toMatch(new RegExp('href="/admin/events/' + event.id + '/edit"[^>]*aria-label="Edit Morning walk"'));
  expect(page.text).toContain('icon-plus');
  expect(page.text).toContain('Add event');
});

test('events can be searched and filtered by category and LGA', async () => {
  await makeEvent({ title: 'Morning walk', category: 'fitness', area: 'egbeda' });
  await makeEvent({ title: 'Bible study', category: 'faith', area: 'ido' });
  const agent = await staff();

  let page = await agent.get('/admin/events?q=walk');
  expect(page.text).toContain('Morning walk');
  expect(page.text).not.toContain('Bible study');

  page = await agent.get('/admin/events?category=faith');
  expect(page.text).toContain('Bible study');
  expect(page.text).not.toContain('Morning walk');

  page = await agent.get('/admin/events?area=egbeda');
  expect(page.text).toContain('Morning walk');
  expect(page.text).not.toContain('Bible study');

  page = await agent.get('/admin/events?q=Test%20Org'); // the organization's name
  expect(page.text).toContain('Morning walk');
  expect(page.text).toContain('Bible study');
});

test('organizations: the list has no form; Add organization opens one, with the LGA', async () => {
  const agent = await staff();
  const list = await agent.get('/admin/organizations');
  expect(list.text).toContain('href="/admin/organizations/new"');
  expect(list.text).not.toContain('name="contactName"');

  const form = await agent.get('/admin/organizations/new');
  expect(form.text).toContain('name="lga"');
  const res = await agent.post('/admin/organizations').type('form')
    .send({ _csrf: csrfFrom(form.text), name: 'Agbowo Seniors Club', lga: 'ibadan-north', address: '12 Agbowo Road' });
  expect(res.headers.location).toBe('/admin/organizations');
  const org = await Organization.findOne({ where: { name: 'Agbowo Seniors Club' } });
  expect(org.lga).toBe('ibadan-north');
  expect(org.address).toBe('12 Agbowo Road');

  const empty = await agent.post('/admin/organizations').type('form').send({ _csrf: csrfFrom(form.text), name: '' });
  expect(empty.status).toBe(400);
  expect(empty.text).toContain('Please give the organization a name.');
});

test('organizations can be searched and filtered by LGA', async () => {
  await Organization.create({ name: 'Agbowo Seniors Club', lga: 'ibadan-north' });
  await Organization.create({ name: 'Moniya Church', lga: 'akinyele' });
  const agent = await staff();

  let page = await agent.get('/admin/organizations?q=moniya');
  expect(page.text).toContain('Moniya Church');
  expect(page.text).not.toContain('Agbowo Seniors Club');

  page = await agent.get('/admin/organizations?lga=ibadan-north');
  expect(page.text).toContain('Agbowo Seniors Club');
  expect(page.text).not.toContain('Moniya Church');
});

test('seniors: a table that links to each profile, with their events', async () => {
  const senior = await makeUser({ fullName: 'Mama Tolu', lga: 'egbeda' });
  const event = await makeEvent({ title: 'Morning walk' });
  await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee', status: 'attended' });
  const agent = await staff();

  const list = await agent.get('/admin/seniors?lga=egbeda');
  expect(list.text).toContain('href="/admin/seniors/' + senior.id + '"');
  expect((await agent.get('/admin/seniors?lga=ido')).text).not.toContain('Mama Tolu');

  const profile = await agent.get('/admin/seniors/' + senior.id);
  expect(profile.text).toContain('Mama Tolu');
  expect(profile.text).toContain('Morning walk');
  expect(profile.text).toContain('Delete account');
});

test('door check-in: one tap marks someone as came, sends back their row and the count, and can be undone', async () => {
  const senior = await makeUser({ fullName: 'Mama Tolu' });
  const other = await makeUser({ fullName: 'Baba Kunle' });
  const event = await makeEvent();
  const reg = await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee' });
  await Registration.create({ eventId: event.id, seniorId: other.id, type: 'attendee' });
  const agent = await staff();

  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  expect(page.text).toContain('Mama Tolu');
  expect(page.text).toContain('of <span data-count="total">2</span> checked in');
  const url = '/admin/events/' + event.id + '/registrations/' + reg.id + '/status';

  const tap = await agent.post(url).set('X-Requested-With', 'fetch').type('form').send({ _csrf: csrfFrom(page.text), status: 'attended' });
  expect(tap.body.status).toBe('attended');
  expect(tap.body.counts).toEqual({ came: 1, missed: 0, waiting: 1, total: 2 });
  expect(tap.body.html).toContain('Undo');
  expect((await reg.reload()).status).toBe('attended');

  const undo = await agent.post(url).type('form').send({ _csrf: csrfFrom(page.text), status: 'registered' }); // without JavaScript
  expect(undo.headers.location).toBe('/admin/events/' + event.id + '/attendance');
  expect((await reg.reload()).status).toBe('registered');
});

test('after the event, everyone not ticked can be marked as didn\'t come in one go', async () => {
  const event = await makeEvent({ startsAt: new Date(Date.now() - 3 * 3600 * 1000), endsAt: new Date(Date.now() - 3600 * 1000), registrationDeadline: new Date(Date.now() - 4 * 3600 * 1000) });
  const came = await Registration.create({ eventId: event.id, seniorId: (await makeUser()).id, type: 'attendee', status: 'attended' });
  const waiting = await Registration.create({ eventId: event.id, seniorId: (await makeUser()).id, type: 'attendee' });
  const agent = await staff();
  const page = await agent.get('/admin/events/' + event.id + '/attendance');
  await agent.post('/admin/events/' + event.id + '/rest-missed').type('form').send({ _csrf: csrfFrom(page.text) });
  expect((await waiting.reload()).status).toBe('no_show');
  expect((await came.reload()).status).toBe('attended');
});

test('staff describe the flyer; screen readers hear it, or "Flyer for" the title when it is empty', async () => {
  const described = await makeEvent({ title: 'Morning walk', imageUrl: 'https://example.com/a.jpg', imageAlt: 'Seniors walking in Agodi Gardens' });
  const plain = await makeEvent({ title: 'Bible study', imageUrl: 'https://example.com/b.jpg' });

  const form = await (await staff()).get('/admin/events/' + described.id + '/edit');
  expect(form.text).toContain('name="imageAlt"');
  expect(form.text).toContain('Seniors walking in Agodi Gardens');

  expect((await request(app).get('/events/' + described.id)).text).toContain('alt="Seniors walking in Agodi Gardens"');
  expect((await request(app).get('/events/' + plain.id)).text).toContain('alt="Flyer for Bible study"');
});

test('Register and Skip buttons say which event they are for', async () => {
  const event = await makeEvent({ title: 'Morning walk' });
  const senior = await makeUser();
  const agent = request.agent(app);
  await signIn(agent, senior.phone);
  const page = await agent.get('/events?area=all');
  expect(page.text).toMatch(/aria-label="Register: Morning walk, [^"]+"/);
  expect(page.text).toMatch(/aria-label="Skip: Morning walk, [^"]+"/);
  expect((await agent.get('/events/' + event.id)).text).toMatch(/aria-label="Register: Morning walk, [^"]+"/);
});

test('the welcome video is gone from the staff menu', async () => {
  const page = await (await staff()).get('/admin');
  expect(page.text).not.toContain('Welcome video');
  expect(page.text).not.toContain('/admin/onboarding-video');
});
