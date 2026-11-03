// An admin edits an event and chooses whether to tell the registered seniors what is new.
const request = require('supertest');
const app = require('../src/app');
const { Registration, Notification, AuditLog } = require('../src/models');
const notifier = require('../src/services/notify');
const dates = require('../src/services/dates');
const updates = require('../src/services/eventUpdates');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => sequelize.close());

async function adminAgent() {
  const admin = await makeUser({ role: 'admin', fullName: 'Staff Person' });
  const agent = request.agent(app);
  await signIn(agent, admin.phone);
  return agent;
}

// what the edit form would send for this event, with some things changed
function body(event, changes = {}) {
  return {
    title: event.title, description: event.description,
    startsAt: dates.toLocalInput(event.startsAt), endsAt: dates.toLocalInput(event.endsAt), registrationDeadline: dates.toLocalInput(event.registrationDeadline),
    locationText: event.locationText, area: event.area || 'ibadan-north', category: event.category, organizationId: String(event.organizationId),
    capacity: String(event.capacity || 20), pricing: event.price > 0 ? 'paid' : 'free', price: event.price ? String(event.price) : '',
    ...changes
  };
}

async function edit(agent, event, changes, notify) {
  const form = await agent.get('/admin/events/' + event.id + '/edit');
  const fields = { _csrf: csrfFrom(form.text), ...body(event, changes) };
  if (notify) fields.notify = notify;
  return agent.post('/admin/events/' + event.id + '/edit').type('form').send(fields);
}

async function registered(event, extra = {}, type = 'attendee', status = 'registered') {
  const senior = await makeUser(extra);
  await Registration.create({ eventId: event.id, seniorId: senior.id, type, status });
  return senior;
}

const NEW_START = new Date(Date.now() + 6 * DAY);
const NEW_END = new Date(Date.now() + 6 * DAY + 2 * 60 * 60 * 1000);
const newTimes = { startsAt: dates.toLocalInput(NEW_START), endsAt: dates.toLocalInput(NEW_END) };
const sentTo = (spy) => spy.mock.calls.map((c) => c[0].id).sort();

test('the edit page offers "Save and notify" and "Save without notifying" only when seniors are registered', async () => {
  const agent = await adminAgent();
  const event = await makeEvent({ area: 'ibadan-north' });
  const empty = await agent.get('/admin/events/' + event.id + '/edit');
  expect(empty.text).not.toContain('Save and notify');
  expect(empty.text).toContain('Save changes');

  await registered(event);
  await registered(event);
  const form = await agent.get('/admin/events/' + event.id + '/edit');
  expect(form.text).toContain('Save and notify 2 registered seniors');
  expect(form.text).toContain('Save without notifying');
  expect(form.text).toMatch(/name="notify" value="yes"/);
  expect(form.text).toMatch(/name="notify" value="no"/);
  expect(form.text).toContain('2 seniors are registered');

  expect((await agent.get('/admin/events/new')).text).not.toContain('Save and notify'); // a new event has nobody to tell
});

test('a changed date and time, with "notify": every registered senior is told the new date and time', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent({ title: 'Morning walk', area: 'ibadan-north' });
  const a = await registered(event, { fullName: 'Mama Tolu Adeyemi' });
  const b = await registered(event, { fullName: 'Baba Kunle' }, 'volunteer'); // volunteers have a place too
  const gone = await registered(event, {}, 'attendee', 'cancelled'); // gave up their place
  const other = await registered(await makeEvent({ title: 'Another event' })); // a different event

  const res = await edit(agent, event, newTimes, 'yes');
  expect(res.status).toBe(302);

  expect(sentTo(notify)).toEqual([a.id, b.id]);
  const expected = dates.formatDate(NEW_START, 'en') + ', ' + dates.formatTime(NEW_START) + ' – ' + dates.formatTime(NEW_END);
  for (const call of notify.mock.calls) {
    expect(call[1]).toBe('event.updated');
    expect(call[2].event).toBe('Morning walk');
    expect(call[2].changes).toBe('New date and time: ' + expected + '.');
  }
  expect(notify.mock.calls.map((c) => c[0].id)).not.toContain(gone.id);
  expect(notify.mock.calls.map((c) => c[0].id)).not.toContain(other.id);

  // a notice in each senior's Notifications, linking to the event
  const notice = await Notification.findOne({ where: { userId: a.id, type: 'event.updated' } });
  expect(notice.link).toBe('/events/' + event.id);
  expect(notice.payload.changes).toContain('New date and time');
  expect(await Notification.count({ where: { type: 'event.updated' } })).toBe(2);
  expect(await AuditLog.findOne({ where: { action: 'event.update_notified', entityId: event.id } })).toBeTruthy();

  // the text a senior receives says what is new
  const sms = t('event.updated.sms', 'en', { name: 'Mama Tolu', event: 'Morning walk', changes: notify.mock.calls[0][2].changes });
  expect(sms).toContain('Morning walk');
  expect(sms).toContain('New date and time');
  expect(sms).toContain('Your place is saved');

  const page = await (async () => { const s = request.agent(app); await signIn(s, a.phone); return s.get('/notifications'); })();
  expect(page.text).toContain('Morning walk has changed');
  expect(page.text).toContain('New date and time');
});

test('the admin is told how many seniors were told, and the event is saved either way', async () => {
  jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent();
  await registered(event);
  await registered(event);
  const res = await edit(agent, event, newTimes, 'yes');
  const list = await agent.get(res.headers.location);
  expect(list.text).toContain('Changes saved.');
  expect(list.text).toContain('2 registered seniors were told what is new');
  expect(dates.toLocalInput((await event.reload()).startsAt)).toBe(newTimes.startsAt);
});

test('a new place, a new name and a new price are each described, in one message', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent({ title: 'Tea morning', locationText: 'Old Hall', area: 'ibadan-north', price: null });
  await registered(event);
  await edit(agent, event, { title: 'Big tea morning', locationText: 'Agodi Gardens, main gate', area: 'egbeda', pricing: 'paid', price: '2500' }, 'yes');
  const changes = notify.mock.calls[0][2].changes;
  expect(changes).toContain('New name: Big tea morning.');
  expect(changes).toContain('New place: Agodi Gardens, main gate, Egbeda.');
  expect(changes).toContain('New price: ₦2,500.');
  expect(changes).not.toContain('New date and time'); // only what changed
  expect(notify.mock.calls[0][2].event).toBe('Big tea morning');
});

test('"Save without notifying" saves the change and tells nobody', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent();
  await registered(event);
  const res = await edit(agent, event, newTimes, 'no');
  expect(res.status).toBe(302);
  expect(notify).not.toHaveBeenCalled();
  expect(await Notification.count({ where: { type: 'event.updated' } })).toBe(0);
  expect(dates.toLocalInput((await event.reload()).startsAt)).toBe(newTimes.startsAt);

  // and without any choice at all (an old page, a script), it is the same: nobody is told
  await edit(agent, event, { startsAt: dates.toLocalInput(new Date(Date.now() + 7 * DAY)), endsAt: dates.toLocalInput(new Date(Date.now() + 7 * DAY + 3600000)) }, null);
  expect(notify).not.toHaveBeenCalled();
});

test('"notify" when nothing a senior would notice changed tells nobody, and says so', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent({ area: 'ibadan-north' });
  await registered(event);
  const res = await edit(agent, event, { description: 'A longer description, same event.', capacity: '30' }, 'yes');
  expect(notify).not.toHaveBeenCalled();
  expect((await agent.get(res.headers.location)).text).toContain('Nothing a senior would notice had changed');
});

test('"notify" when nobody is registered says so, and does not fail', async () => {
  jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent();
  const res = await edit(agent, event, newTimes, 'yes');
  expect(res.status).toBe(302);
  expect((await agent.get(res.headers.location)).text).toContain('Nobody is registered yet');
});

test('each senior is told in their own language', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent({ title: 'Morning walk' });
  const english = await registered(event, { preferredLanguage: 'en' });
  const yoruba = await registered(event, { preferredLanguage: 'yo' });
  await edit(agent, event, newTimes, 'yes');
  const forUser = (id) => notify.mock.calls.find((c) => c[0].id === id)[2].changes;
  expect(forUser(english.id)).toContain('New date and time:');
  expect(forUser(yoruba.id)).toContain('Ọjọ́ àti àkókò tuntun:');
  expect(forUser(yoruba.id)).not.toContain('New date and time');
  expect((await Notification.findOne({ where: { userId: yoruba.id, type: 'event.updated' } })).payload.changes).toContain('Ọjọ́ àti àkókò tuntun');
});

test('a changed date sends the reminder again for the new date; other edits leave reminders alone', async () => {
  jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const agent = await adminAgent();
  const event = await makeEvent();
  const senior = await registered(event);
  const reg = await Registration.findOne({ where: { seniorId: senior.id } });
  await reg.update({ reminderSentAt: new Date() });

  await edit(agent, event, { description: 'only the words changed' }, 'no');
  expect((await reg.reload()).reminderSentAt).not.toBeNull();
  await edit(agent, await event.reload(), newTimes, 'no');
  expect((await reg.reload()).reminderSentAt).toBeNull(); // due again, for the new date
});

test('only staff can edit an event or send these messages', async () => {
  const notify = jest.spyOn(notifier, 'notify').mockImplementation(() => {});
  const event = await makeEvent();
  await registered(event);
  const senior = await makeUser();
  const agent = request.agent(app);
  await signIn(agent, senior.phone);
  const page = await agent.get('/events');
  const res = await agent.post('/admin/events/' + event.id + '/edit').type('form').send({ _csrf: csrfFrom(page.text), ...body(event, newTimes), notify: 'yes' });
  expect(res.status).toBe(403);
  expect(notify).not.toHaveBeenCalled();
});

describe('what changed, in plain functions', () => {
  test('only the name, the date and time, the place and the price count', () => {
    const event = { title: 'A', startsAt: new Date('2026-12-01T09:00:00Z'), endsAt: new Date('2026-12-01T11:00:00Z'), locationText: 'Hall', area: 'ido', price: null };
    const before = updates.snapshot(event);
    expect(updates.whatChanged(before, event)).toEqual({ title: false, when: false, place: false, price: false });
    expect(updates.whatChanged(before, { ...event, endsAt: new Date('2026-12-01T12:00:00Z') }).when).toBe(true); // a later finish counts
    expect(updates.whatChanged(before, { ...event, area: 'egbeda' }).place).toBe(true);
    expect(updates.whatChanged(before, { ...event, price: 500 }).price).toBe(true);
    expect(updates.whatChanged(before, { ...event, price: 0 }).price).toBe(false); // empty and 0 both mean free
    expect(updates.describe({ ...event, price: 0, title: 'B' }, { title: true, when: false, place: false, price: true }, 'en')).toEqual(['New name: B.', 'New price: Free.']);
  });
});
