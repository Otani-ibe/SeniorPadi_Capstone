const { Registration } = require('../src/models');
const capacity = require('../src/services/capacity');
const { resetDb, makeUser, makeEvent, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

test('many people registering at once never goes over capacity', async () => {
  const event = await makeEvent({ capacity: 3 });
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await makeUser());

  const results = await Promise.all(users.map((u) => capacity.register(event.id, u.id, 'attendee')));

  expect(results.filter((r) => r.ok).length).toBe(3);
  expect(results.filter((r) => r.reason === 'full').length).toBe(7);
  expect(await capacity.countTaken(event.id, 'attendee')).toBe(3);
});

test('attendee and volunteer spots are counted separately', async () => {
  const event = await makeEvent({ capacity: 1, volunteerEnabled: true, volunteerCapacity: 1 });
  const a = await makeUser();
  const b = await makeUser();

  expect((await capacity.register(event.id, a.id, 'attendee')).ok).toBe(true);
  expect((await capacity.register(event.id, b.id, 'volunteer')).ok).toBe(true);
  // the same senior can attend and volunteer
  expect((await capacity.register(event.id, a.id, 'volunteer')).reason).toBe('full');
  expect((await capacity.register(event.id, b.id, 'attendee')).reason).toBe('full');
});

test('cancelled and no-show registrations do not take a seat', async () => {
  const event = await makeEvent({ capacity: 2 });
  const a = await makeUser();
  const b = await makeUser();
  const c = await makeUser();

  await Registration.create({ eventId: event.id, seniorId: a.id, type: 'attendee', status: 'cancelled' });
  await Registration.create({ eventId: event.id, seniorId: b.id, type: 'attendee', status: 'no_show' });
  await Registration.create({ eventId: event.id, seniorId: c.id, type: 'attendee', status: 'registered' });

  expect(await capacity.countTaken(event.id, 'attendee')).toBe(1);
});

test('someone who cancelled can register again', async () => {
  const event = await makeEvent({ capacity: 5 });
  const a = await makeUser();
  const first = await capacity.register(event.id, a.id, 'attendee');
  await first.registration.update({ status: 'cancelled' });

  const again = await capacity.register(event.id, a.id, 'attendee');
  expect(again.ok).toBe(true);
  expect(await Registration.count()).toBe(1);
});

test('registration is refused after the deadline', async () => {
  const event = await makeEvent({ registrationDeadline: new Date(Date.now() - DAY) });
  const a = await makeUser();
  expect((await capacity.register(event.id, a.id, 'attendee')).reason).toBe('closed');
});

describe('tags', () => {
  const now = new Date();
  const base = {
    status: 'published',
    capacity: 20,
    volunteerEnabled: false,
    startsAt: new Date(now.getTime() + 10 * DAY),
    endsAt: new Date(now.getTime() + 10 * DAY),
    registrationDeadline: new Date(now.getTime() + 9 * DAY)
  };

  test('almost full shows at 5 or fewer spots left', () => {
    expect(capacity.eventState(base, 14, 0, now).attendeeAlmostFull).toBe(false);
    expect(capacity.eventState(base, 15, 0, now).attendeeAlmostFull).toBe(true);
    expect(capacity.eventState(base, 19, 0, now).attendeeAlmostFull).toBe(true);
  });

  test('capacity reached when every seat is taken', () => {
    const state = capacity.eventState(base, 20, 0, now);
    expect(state.attendeeFull).toBe(true);
    expect(state.attendeeAlmostFull).toBe(false);
  });

  test('deadline warning shows at 5 or fewer days', () => {
    expect(capacity.eventState(base, 0, 0, now).closesSoon).toBe(false);
    const soon = { ...base, registrationDeadline: new Date(now.getTime() + 5 * DAY) };
    const state = capacity.eventState(soon, 0, 0, now);
    expect(state.closesSoon).toBe(true);
    expect(state.daysToDeadline).toBe(5);
  });
});
