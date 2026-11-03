// Integration tests: the senior's real history and the real events in the database, through recommendForUser.
const { Registration, EventInterest, Attendance } = require('../src/models');
const { recommendForUser, reasonText } = require('../src/services/recommendations');
const { t } = require('../src/services/i18n');
const { resetDb, makeUser, makeEvent, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const BODIJA = { latitude: 7.4322, longitude: 3.9136 };
const MOKOLA = { latitude: 7.4, longitude: 3.895 }; // about 4 km from Bodija
const MONIYA = { latitude: 7.5329, longitude: 3.9187 }; // about 11 km from Bodija

const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000), registrationDeadline: new Date(Date.now() + (days - 0.5) * DAY) });
const earlier = (days) => ({ startsAt: new Date(Date.now() - days * DAY), endsAt: new Date(Date.now() - days * DAY + 3600000), registrationDeadline: new Date(Date.now() - (days + 1) * DAY) });
const event = (title, category, place, days, extra = {}) => makeEvent({ title, category, area: 'ibadan-north', geoSource: 'geocoded', ...place, ...later(days), ...extra });
const names = (picks) => picks.map((p) => p.event.title);
const book = (senior, ev, status = 'registered') => Registration.create({ eventId: ev.id, seniorId: senior.id, type: 'attendee', status });

test('what they attended decides the order; places and hosts they know add to it', async () => {
  const senior = await makeUser({ ...BODIJA });
  const doneA = await event('Past walk 1', 'fitness', MOKOLA, 1, earlier(20));
  const doneB = await event('Past walk 2', 'fitness', MOKOLA, 1, earlier(10));
  await book(senior, doneA, 'attended');
  await book(senior, doneB, 'attended');

  await event('Morning walk', 'fitness', MOKOLA, 4);
  await event('Choir practice', 'faith', MOKOLA, 4);
  await event('Craft hour', 'creativity', MOKOLA, 4);

  const picks = await recommendForUser(senior, { limit: 3 });
  expect(names(picks)[0]).toBe('Morning walk');
  expect(picks[0].score).toBeGreaterThan(picks[1].score);
  expect(picks[0].reasons[0]).toMatchObject({ code: 'attended_category', params: { category: 'fitness', count: 2 } });
  expect(reasonText(picks[0].reasons[0], (k, v) => t(k, 'en', v))).toBe('You have been to 2 Fitness event(s) before');
});

test('a chosen interest (the "tell me about this" button) lifts that category', async () => {
  const senior = await makeUser({ ...BODIJA });
  await EventInterest.create({ seniorId: senior.id, category: 'health', sourceEventId: null });
  await event('Craft hour', 'creativity', MOKOLA, 4);
  await event('Blood pressure check', 'health', MOKOLA, 4);
  const picks = await recommendForUser(senior);
  expect(names(picks)[0]).toBe('Blood pressure check');
  expect(picks[0].reasons.map((r) => r.code)).toContain('chose_interest');
});

test('booking an event and also pressing "tell me about this" for it counts once, not twice', async () => {
  const withBoth = await makeUser({ ...BODIJA });
  const bookedOnly = await makeUser({ ...BODIJA });
  const source = await event('Source event', 'health', MOKOLA, 6);
  await book(withBoth, source);
  await book(bookedOnly, source);
  await EventInterest.create({ seniorId: withBoth.id, category: 'health', sourceEventId: source.id });
  await event('Another health talk', 'health', MOKOLA, 4);

  const a = (await recommendForUser(withBoth))[0];
  const b = (await recommendForUser(bookedOnly))[0];
  expect(a.event.title).toBe('Another health talk');
  expect(a.components.interest).toBe(b.components.interest);
  expect(a.score).toBe(b.score);
});

test('a check-in counts as attended even if the booking row was not updated', async () => {
  const senior = await makeUser({ ...BODIJA });
  const done = await event('Old class', 'learning', MOKOLA, 1, earlier(5));
  const reg = await book(senior, done, 'registered'); // still says "registered"
  await Attendance.create({ eventId: done.id, registrationId: reg.id, seniorId: senior.id, method: 'manual' });
  await event('New class', 'learning', MOKOLA, 4);
  const [pick] = await recommendForUser(senior);
  expect(pick.reasons).toContainEqual({ code: 'attended_category', params: { category: 'learning', count: 1 } });
});

test('a cancelled booking is not read as taste', async () => {
  const senior = await makeUser({ ...BODIJA });
  const gaveUp = await event('Gave up', 'fitness', MOKOLA, 5);
  await book(senior, gaveUp, 'cancelled');
  await event('Walk', 'fitness', MOKOLA, 4);
  const [pick] = await recommendForUser(senior);
  expect(pick.components.interest).toBeNull(); // no signals at all
  expect(pick.reasons.map((r) => r.code)).not.toContain('booked_category');
});

test('events in different neighbourhoods: nearer ones win when interest is equal', async () => {
  const senior = await makeUser({ ...BODIJA });
  await event('Far event', 'social', MONIYA, 4);
  await event('Near event', 'social', MOKOLA, 4);
  const picks = await recommendForUser(senior, { limit: 2, config: { diversity: { maxShareOfCategory: 1 } } });
  expect(names(picks)).toEqual(['Near event', 'Far event']);
  expect(picks[0].event.distanceKm).toBeLessThan(picks[1].event.distanceKm);
  expect(picks[0].components.proximity).toBeGreaterThan(picks[1].components.proximity);
});

test('expired, cancelled, completed, closed, full and already booked events are never recommended', async () => {
  const senior = await makeUser({ ...BODIJA });
  const other = await makeUser();
  await event('Good', 'social', MOKOLA, 3);
  await event('Cancelled', 'social', MOKOLA, 3, { status: 'cancelled' });
  await event('Completed', 'social', MOKOLA, 3, { status: 'completed' });
  await event('Expired', 'social', MOKOLA, 1, earlier(3));
  await event('Closed', 'social', MOKOLA, 3, { registrationDeadline: new Date(Date.now() - 3600000) });
  const full = await event('Full', 'social', MOKOLA, 3, { capacity: 1 });
  await book(other, full);
  const mine = await event('Mine already', 'social', MOKOLA, 3);
  await book(senior, mine);

  const picks = await recommendForUser(senior, { limit: 20 });
  expect(names(picks)).toEqual(['Good']);
});

test('a brand-new senior with no history and no place still gets sensible recommendations', async () => {
  const senior = await makeUser(); // no area, no coordinates, no registrations, no interests
  await event('Soon', 'social', MOKOLA, 2);
  await event('Later', 'faith', MONIYA, 30);
  const picks = await recommendForUser(senior, { limit: 5 });
  expect(names(picks)).toEqual(['Soon', 'Later']);
  expect(picks.every((p) => p.event.distanceKm === null && p.components.proximity === null && p.components.interest === null)).toBe(true);
  expect(picks.every((p) => p.reasons.length >= 1 && p.score > 0 && p.score <= 100)).toBe(true);
});

test('a visitor who is not signed in gets recommendations too', async () => {
  await event('Open to all', 'social', MOKOLA, 2);
  const picks = await recommendForUser(null);
  expect(names(picks)).toEqual(['Open to all']);
});

test('a senior with a place but no saved coordinates is placed by their area, and the reason says approximately', async () => {
  const senior = await makeUser({ lga: 'ibadan-north', area: 'Bodija' }); // no latitude / longitude yet
  await event('Nearby', 'social', { latitude: 7.43, longitude: 3.92 }, 3);
  const [pick] = await recommendForUser(senior);
  expect(pick.event.distanceApproximate).toBe(true);
  expect(pick.reasons.map((r) => r.code)).toContain('near_area');
});

test('an event with no coordinates or area is still recommended, just without distance', async () => {
  const senior = await makeUser({ ...BODIJA });
  await makeEvent({ title: 'Nowhere in particular', area: null, ...later(3) });
  const [pick] = await recommendForUser(senior);
  expect(pick.event.title).toBe('Nowhere in particular');
  expect(pick.components.proximity).toBeNull();
});

test('the list mixes categories even for someone who only ever goes to one', async () => {
  const senior = await makeUser({ ...BODIJA });
  for (let i = 0; i < 3; i++) await book(senior, await event('Past ' + i, 'fitness', MOKOLA, 1, earlier(5 + i)), 'attended');
  for (let i = 0; i < 5; i++) await event('Fitness ' + i, 'fitness', MOKOLA, 2 + i);
  await event('Choir', 'faith', MONIYA, 6);
  await event('Painting', 'creativity', MONIYA, 6);
  await event('Quiz night', 'learning', MONIYA, 6);

  const picks = await recommendForUser(senior, { limit: 4 });
  const categories = picks.map((p) => p.event.category);
  expect(categories.filter((c) => c === 'fitness').length).toBeLessThanOrEqual(2);
  expect(categories[0]).toBe('fitness');
  expect(new Set(categories).size).toBeGreaterThanOrEqual(3);
});

test('the weights can be changed for one call', async () => {
  const senior = await makeUser({ ...BODIJA });
  await book(senior, await event('Past', 'fitness', MOKOLA, 1, earlier(5)), 'attended');
  await event('Liked but far', 'fitness', MONIYA, 4);
  await event('Not liked but close', 'faith', MOKOLA, 4);
  const normal = await recommendForUser(senior, { limit: 2 });
  const onlyDistance = await recommendForUser(senior, { limit: 2, config: { weights: { interest: 0, proximity: 1, interactions: 0, freshness: 0, diversity: 0 } } });
  expect(normal[0].event.title).toBe('Liked but far');
  expect(onlyDistance[0].event.title).toBe('Not liked but close');
});

test('reading the history and events takes a small, fixed number of queries', async () => {
  const senior = await makeUser({ ...BODIJA });
  for (let i = 0; i < 6; i++) await book(senior, await event('Past ' + i, 'social', MOKOLA, 1, earlier(3 + i)), 'attended');
  for (let i = 0; i < 12; i++) await event('Upcoming ' + i, 'social', MOKOLA, 2 + i);
  let queries = 0;
  const count = () => { queries++; };
  sequelize.addHook('beforeQuery', count);
  try { await recommendForUser(senior, { limit: 6 }); } finally { sequelize.removeHook('beforeQuery', count); }
  expect(queries).toBeLessThanOrEqual(8); // not one per event
});
