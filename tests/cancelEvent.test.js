// Staff can cancel an event from the Events list and from the event's Edit page.
const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const notifier = require('../src/services/notify');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize } = require('./helpers');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => sequelize.close());

async function staff() {
  const agent = request.agent(app);
  await signIn(agent, (await makeUser({ role: 'admin' })).phone);
  return agent;
}
const register = async (event, extra = {}, status = 'registered') => {
  const senior = await makeUser(extra);
  await Registration.create({ eventId: event.id, seniorId: senior.id, type: 'attendee', status });
  return senior;
};

test('the Edit page has a clear "Cancel this event" button, with how many seniors will be told', async () => {
  const agent = await staff();
  const event = await makeEvent({ area: 'ibadan-north' });
  await register(event);
  await register(event);
  const page = await agent.get('/admin/events/' + event.id + '/edit');
  expect(page.text).toContain('Cancel this event');
  expect(page.text).toContain('2 registered seniors are told by text');
  expect(page.text).toContain('action="/admin/events/' + event.id + '/cancel"');
  expect(page.text).toMatch(/class="abtn-danger"/);

  const empty = await makeEvent({ area: 'ibadan-north' });
  expect((await agent.get('/admin/events/' + empty.id + '/edit')).text).toContain('Nobody is registered yet');
});

test('the Events list shows the Cancel button in the same style, for published events only', async () => {
  const agent = await staff();
  const live = await makeEvent({ title: 'Still on' });
  const gone = await makeEvent({ title: 'Already off', status: 'cancelled' });
  const list = (await agent.get('/admin/events')).text;
  expect(list).toContain('action="/admin/events/' + live.id + '/cancel"');
  expect(list).not.toContain('action="/admin/events/' + gone.id + '/cancel"');
  expect(list).toMatch(/class="abtn-danger abtn-sm">Cancel event/);
});

test('cancelling hides the event from seniors, tells the registered seniors, and keeps the registrations', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await staff();
  const event = await makeEvent({ title: 'Morning walk', area: 'ibadan-north' });
  const coming = await register(event);
  const gaveUp = await register(event, {}, 'cancelled');
  expect((await request(app).get('/events')).text).toContain('Morning walk');

  const page = await agent.get('/admin/events/' + event.id + '/edit');
  const res = await agent.post('/admin/events/' + event.id + '/cancel').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(res.status).toBe(302);

  expect((await event.reload()).status).toBe('cancelled');
  expect(notify.mock.calls.map((c) => [c[0].id, c[1]])).toEqual([[coming.id, 'event.cancelled_by_admin']]); // not the one who had already left
  expect(notify.mock.calls[0][2].event).toBe('Morning walk');
  expect((await request(app).get('/events')).text).not.toContain('Morning walk'); // gone from the site
  expect(await Registration.count({ where: { eventId: event.id } })).toBe(2); // the history stays
  expect((await agent.get('/admin/events')).text).toContain('Cancelled'); // and it is still in the staff list
  expect((await agent.get('/admin/events/' + event.id + '/edit')).text).toContain('This event was cancelled');
  expect(gaveUp).toBeTruthy();
});

test('cancelling twice does not tell everyone twice, and only staff can cancel', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await staff();
  const event = await makeEvent();
  await register(event);
  const page = await agent.get('/admin/events/' + event.id + '/edit');
  await agent.post('/admin/events/' + event.id + '/cancel').type('form').send({ _csrf: csrfFrom(page.text) });
  await agent.post('/admin/events/' + event.id + '/cancel').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(notify).toHaveBeenCalledTimes(1);

  const other = await makeEvent();
  const senior = request.agent(app);
  await signIn(senior, (await makeUser()).phone);
  const home = await senior.get('/events');
  const res = await senior.post('/admin/events/' + other.id + '/cancel').type('form').send({ _csrf: csrfFrom(home.text) });
  expect(res.status).toBe(403);
  expect((await other.reload()).status).toBe('published');
});
