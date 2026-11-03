const request = require('supertest');
const app = require('../src/app');
const { User, Event, Registration } = require('../src/models');
const geo = require('../src/services/geo');
const geocode = require('../src/services/geocode');
const { nearbyEvents } = require('../src/services/nearby');
const { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterEach(() => geocode.setProvider(null));
afterAll(() => sequelize.close());

// real places in Ibadan: [latitude, longitude]
const BODIJA = { latitude: 7.4322, longitude: 3.9136 };
const MOKOLA = { latitude: 7.4, longitude: 3.895 }; // a few km south of Bodija
const CHALLENGE = { latitude: 7.3445, longitude: 3.8826 }; // about 10 km south
const MONIYA = { latitude: 7.5329, longitude: 3.9187 }; // about 11 km north

const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000), registrationDeadline: new Date(Date.now() + (days - 0.5) * DAY) });
const at = (title, place, days, extra = {}) => makeEvent({ title, ...place, geoSource: 'geocoded', area: 'ibadan-north', ...later(days), ...extra });
const titles = (result) => result.events.map((e) => e.title);

describe('distance maths', () => {
  test('is in kilometres, and latitude and longitude are not mixed up', () => {
    // 0.01 degrees of longitude at Ibadan is about 1.1 km; Bodija to Challenge is about 10 km
    const a = { lat: 7.43, lng: 3.91 };
    expect(geo.distanceKm(a, { lat: 7.43, lng: 3.92 })).toBeCloseTo(1.1, 1);
    expect(geo.distanceKm(a, { lat: 7.44, lng: 3.91 })).toBeCloseTo(1.11, 1);
    expect(geo.distanceKm({ lat: BODIJA.latitude, lng: BODIJA.longitude }, { lat: CHALLENGE.latitude, lng: CHALLENGE.longitude })).toBeGreaterThan(9);
    expect(geo.distanceKm(a, a)).toBe(0);
    // swapping the two would put the point in the Indian Ocean, far away
    expect(geo.distanceKm(a, { lat: a.lng, lng: a.lat })).toBeGreaterThan(300);
  });

  test('rejects numbers that cannot be a place', () => {
    expect(geo.isValidCoordinate(7.4, 3.9)).toBe(true);
    for (const [lat, lng] of [[null, 3.9], [7.4, undefined], ['7.4', '3.9'], [NaN, 3.9], [91, 3.9], [7.4, 181], [0, 0], [Infinity, 3.9]]) {
      expect(geo.isValidCoordinate(lat, lng)).toBe(false);
    }
    expect(geo.insideIbadan(6.5244, 3.3792)).toBe(false); // Lagos
    expect(geo.insideIbadan(7.4, 3.9)).toBe(true);
  });

  test('a record without coordinates falls back to the middle of its area, and to nothing without one', () => {
    expect(geo.locationOf({ lga: 'oluyole' })).toMatchObject({ approximate: true });
    expect(geo.locationOf({ area: 'ido' })).toMatchObject({ approximate: true });
    expect(geo.locationOf({ latitude: 7.4, longitude: 3.9 })).toEqual({ lat: 7.4, lng: 3.9, approximate: false });
    expect(geo.locationOf({ latitude: 7.4, longitude: null, area: 'Bodija' })).toBeNull(); // half a pair, free text
    expect(geo.locationOf({ lga: 'not-an-area' })).toBeNull();
    expect(geo.locationOf(null)).toBeNull();
  });
});

describe('what is stored is checked', () => {
  test('both numbers or neither, and inside the real ranges', async () => {
    await expect(makeUser({ latitude: 7.4 })).rejects.toThrow();
    await expect(makeUser({ longitude: 3.9 })).rejects.toThrow();
    await expect(makeUser({ latitude: 95, longitude: 3.9 })).rejects.toThrow();
    await expect(makeUser({ latitude: 7.4, longitude: 200 })).rejects.toThrow();
    const ok = await makeUser({ ...BODIJA });
    expect(ok.latitude).toBeCloseTo(7.4322);
    expect(ok.longitude).toBeCloseTo(3.9136);
  });
});

describe('nearby events', () => {
  test('are ranked by real distance between neighbourhoods, closest first', async () => {
    const senior = await makeUser({ ...BODIJA });
    await at('Further north: Moniya', MONIYA, 1);
    await at('Far south: Challenge', CHALLENGE, 2);
    await at('Close: Mokola', MOKOLA, 5);

    const result = await nearbyEvents(senior, { radii: [50], minimum: 1 });
    expect(titles(result)).toEqual(['Close: Mokola', 'Far south: Challenge', 'Further north: Moniya']);
    const [mokola, challenge, moniya] = result.events;
    expect(mokola.distanceKm).toBeGreaterThan(3);
    expect(mokola.distanceKm).toBeLessThan(5);
    expect(challenge.distanceKm).toBeGreaterThan(9);
    expect(moniya.distanceKm).toBeGreaterThan(challenge.distanceKm);
    expect(result.located).toBe(true);
    expect(result.approximate).toBe(false);
  });

  test('the same venue is nearer to someone who lives near it', async () => {
    const north = await makeUser({ ...MONIYA });
    const south = await makeUser({ ...CHALLENGE });
    await at('Moniya fair', MONIYA, 2);
    await at('Challenge fair', CHALLENGE, 2);
    expect(titles(await nearbyEvents(north, { radii: [50], minimum: 1 }))[0]).toBe('Moniya fair');
    expect(titles(await nearbyEvents(south, { radii: [50], minimum: 1 }))[0]).toBe('Challenge fair');
  });

  test('the search grows to a wider distance when too few events are close', async () => {
    const senior = await makeUser({ ...BODIJA });
    await at('Mokola', MOKOLA, 1); // about 4 km
    await at('Moniya', MONIYA, 2); // about 11 km
    await at('Challenge', CHALLENGE, 3); // about 10 km
    await at('Akobo', { latitude: 7.4, longitude: 4.0 }, 4); // about 11 km east

    // 5 km holds 1, 10 km holds 1 or 2, 25 km holds all four: with three wanted, it stops at 25
    const grown = await nearbyEvents(senior, { minimum: 3, limit: 10 });
    expect(grown.radiusKm).toBe(25);
    expect(grown.expanded).toBe(true);
    expect(grown.events).toHaveLength(4);

    // one is enough: it stays at the first distance, and nothing beyond it is shown
    const small = await nearbyEvents(senior, { minimum: 1, limit: 10 });
    expect(small.radiusKm).toBe(5);
    expect(small.expanded).toBe(false);
    expect(titles(small)).toEqual(['Mokola']);
  });

  test('when even the widest distance has too few, everything in Ibadan is shown', async () => {
    const senior = await makeUser({ ...BODIJA });
    await at('Only one', MONIYA, 1);
    const result = await nearbyEvents(senior, { minimum: 3 });
    expect(titles(result)).toEqual(['Only one']);
    expect(result.radiusKm).toBeNull();
    expect(result.expanded).toBe(true);
  });

  test('no events at all is an empty list, not an error', async () => {
    const senior = await makeUser({ ...BODIJA });
    expect(await nearbyEvents(senior)).toMatchObject({ events: [], located: true });
  });

  test('leave out cancelled, finished, started, closed, full and already booked events', async () => {
    const senior = await makeUser({ ...BODIJA });
    const other = await makeUser();
    await at('Good one', MOKOLA, 3);
    await at('Cancelled', MOKOLA, 3, { status: 'cancelled' });
    await at('Completed', MOKOLA, 3, { status: 'completed' });
    await at('Already started', MOKOLA, 1, { startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000) });
    await at('Past', MOKOLA, -3, { registrationDeadline: new Date(Date.now() - 5 * DAY) });
    await at('Registration closed', MOKOLA, 3, { registrationDeadline: new Date(Date.now() - 3600000) });
    const full = await at('Full', MOKOLA, 3, { capacity: 1 });
    await Registration.create({ eventId: full.id, seniorId: other.id, type: 'attendee', status: 'registered' });
    const booked = await at('Booked already', MOKOLA, 3);
    await Registration.create({ eventId: booked.id, seniorId: senior.id, type: 'attendee', status: 'registered' });
    const cancelledSeat = await at('Seat given up', MOKOLA, 3, { capacity: 1 });
    await Registration.create({ eventId: cancelledSeat.id, seniorId: other.id, type: 'attendee', status: 'cancelled' });

    const result = await nearbyEvents(senior, { minimum: 1, limit: 20 });
    expect(titles(result).sort()).toEqual(['Good one', 'Seat given up']);
  });

  test('a senior with no saved coordinates is placed in the middle of their area, and told it is approximate', async () => {
    const senior = await makeUser({ lga: 'ibadan-north', area: 'Bodija' }); // no latitude / longitude
    await at('Near the middle of Ibadan North', { latitude: 7.43, longitude: 3.92 }, 2);
    await at('Far away', CHALLENGE, 1);
    const result = await nearbyEvents(senior, { radii: [50], minimum: 1 });
    expect(titles(result)).toEqual(['Near the middle of Ibadan North', 'Far away']);
    expect(result.located).toBe(true);
    expect(result.approximate).toBe(true);
  });

  test('a senior with no location at all still gets events (soonest first) and no distances', async () => {
    const senior = await makeUser(); // no area, no lga, no coordinates
    await at('Later', MOKOLA, 6);
    await at('Sooner', CHALLENGE, 2);
    const result = await nearbyEvents(senior, { limit: 5 });
    expect(titles(result)).toEqual(['Sooner', 'Later']);
    expect(result.located).toBe(false);
    expect(result.events.every((e) => e.distanceKm === null)).toBe(true);
  });

  test('a visitor who is not signed in is treated like a senior with no location', async () => {
    await at('Visible', MOKOLA, 2);
    const result = await nearbyEvents(null);
    expect(titles(result)).toEqual(['Visible']);
    expect(result.located).toBe(false);
  });

  test('an event with no coordinates uses its area; one that cannot be placed at all is left out', async () => {
    const senior = await makeUser({ ...BODIJA });
    await makeEvent({ title: 'Area only', area: 'ibadan-north', ...later(2) }); // no coordinates
    await makeEvent({ title: 'Nowhere', area: null, ...later(1) }); // no coordinates, no area
    const result = await nearbyEvents(senior, { radii: [50], minimum: 1 });
    expect(titles(result)).toEqual(['Area only']);
    expect(result.events[0].distanceApproximate).toBe(true);
    expect(result.events[0].distanceKm).toBeLessThan(5);
  });

  test('half-saved or impossible coordinates in the database are ignored, not trusted', async () => {
    const senior = await makeUser({ ...BODIJA });
    const odd = await at('Odd venue', MOKOLA, 2);
    // written around the checks, the way a bad import might
    await sequelize.query('UPDATE "Events" SET "latitude" = NULL WHERE id = ' + odd.id);
    const result = await nearbyEvents(senior, { radii: [50], minimum: 1 });
    expect(titles(result)).toEqual(['Odd venue']); // falls back to its area
    expect(result.events[0].distanceApproximate).toBe(true);
  });

  test('limit is respected after ranking', async () => {
    const senior = await makeUser({ ...BODIJA });
    for (let i = 0; i < 5; i++) await at('Event ' + i, { latitude: 7.43 + i * 0.01, longitude: 3.91 }, 2);
    const result = await nearbyEvents(senior, { limit: 2, minimum: 1, radii: [50] });
    expect(titles(result)).toEqual(['Event 0', 'Event 1']);
  });
});

describe('finding the coordinates from an address', () => {
  // a pretend lookup service: answers for named places, and remembers what it was asked
  function fakeService(places) {
    const asked = [];
    geocode.setProvider(async (query) => {
      asked.push(query);
      for (const [word, spot] of Object.entries(places)) if (query.startsWith(word)) return spot;
      return null;
    });
    return asked;
  }

  test('a senior who gives a neighbourhood gets its coordinates, latitude and longitude the right way round', async () => {
    const asked = fakeService({ Bodija: { lat: 7.4322, lng: 3.9136 } });
    const user = await makeUser({ lga: 'ibadan-north', area: 'Bodija' });
    await geocode.idle();
    await user.reload();
    expect(asked[0]).toBe('Bodija, Ibadan North, Ibadan, Nigeria');
    expect(user.latitude).toBeCloseTo(7.4322);
    expect(user.longitude).toBeCloseTo(3.9136);
    expect(user.geoSource).toBe('geocoded');
    expect(user.geocodedAt).toBeTruthy();
  });

  test('an event venue is looked up from its address too', async () => {
    fakeService({ 'Mapo Hall': { lat: 7.3775, lng: 3.8964 } });
    const event = await makeEvent({ locationText: 'Mapo Hall, Mapo', area: 'ibadan-south-west', ...later(3) });
    await geocode.idle();
    await event.reload();
    expect([event.latitude, event.longitude]).toEqual([7.3775, 3.8964]);
    expect(event.geoSource).toBe('geocoded');
  });

  test('an address that cannot be found uses the middle of the local government area', async () => {
    fakeService({});
    const user = await makeUser({ lga: 'oluyole', area: 'Nowhereville' });
    await geocode.idle();
    await user.reload();
    expect(user.geoSource).toBe('area');
    expect([user.latitude, user.longitude]).toEqual([geo.AREA_CENTRES.oluyole.lat, geo.AREA_CENTRES.oluyole.lng]);
  });

  test('an answer outside Ibadan (another city\'s street of the same name) is thrown away', async () => {
    fakeService({ Challenge: { lat: 6.5244, lng: 3.3792 } }); // Lagos
    const user = await makeUser({ lga: 'ibadan-south-west', area: 'Challenge' });
    await geocode.idle();
    await user.reload();
    expect(user.geoSource).toBe('area');
    expect(geo.insideIbadan(user.latitude, user.longitude)).toBe(true);
  });

  test('a broken or nonsense answer from the service never breaks saving', async () => {
    geocode.setProvider(async () => { throw new Error('service is down'); });
    const user = await makeUser({ lga: 'ido', area: 'Ido town' });
    await geocode.idle(); // the failure is swallowed
    await user.reload();
    expect(user.latitude).toBeNull();
    expect(user.fullName).toBeTruthy();

    geocode.setProvider(async () => ({ lat: NaN, lng: 'x' }));
    const second = await makeUser({ lga: 'ido', area: 'Ido town' });
    await geocode.idle();
    await second.reload();
    expect(second.geoSource).toBe('area');
  });

  test('someone with no area and no address gets no coordinates, and is not looked up', async () => {
    const asked = fakeService({});
    const user = await makeUser();
    await geocode.idle();
    await user.reload();
    expect(asked).toEqual([]);
    expect(user.latitude).toBeNull();
    expect(user.longitude).toBeNull();
  });

  test('changing the address clears the old coordinates and finds new ones', async () => {
    fakeService({ Bodija: { lat: 7.4322, lng: 3.9136 }, Challenge: { lat: 7.3445, lng: 3.8826 } });
    const user = await makeUser({ lga: 'ibadan-north', area: 'Bodija' });
    await geocode.idle();
    await user.reload();
    expect(user.latitude).toBeCloseTo(7.4322);

    await user.update({ area: 'Challenge', lga: 'ibadan-south-west' });
    expect(user.latitude).toBeNull(); // the old ones are gone at once, never kept next to a new address
    await geocode.idle();
    await user.reload();
    expect(user.latitude).toBeCloseTo(7.3445);

    // saving something else does not look anything up again
    const asked = fakeService({});
    await user.update({ bio: 'Hello' });
    await geocode.idle();
    expect(asked).toEqual([]);
  });

  test('signing up with a neighbourhood ends with coordinates on the account', async () => {
    fakeService({ Akobo: { lat: 7.4, lng: 3.99 } });
    const agent = request.agent(app);
    const page = await agent.get('/signup');
    await agent.post('/signup').type('form').send({
      _csrf: csrfFrom(page.text), fullName: 'Mama Akobo', phone: '0805 321 4321', lga: 'egbeda', area: 'Akobo', ageDeclared: 'yes'
    });
    await geocode.idle();
    const user = await User.findOne({ where: { fullName: 'Mama Akobo' } });
    expect(user.latitude).toBeCloseTo(7.4);
    expect(user.longitude).toBeCloseTo(3.99);
  });

  test('every local government area has a middle that is inside Ibadan and a name in the locale file', () => {
    expect(Object.keys(geo.AREA_CENTRES).sort()).toEqual(Event.AREAS.slice().sort());
    for (const [key, c] of Object.entries(geo.AREA_CENTRES)) {
      expect(geo.insideIbadan(c.lat, c.lng)).toBe(true);
      expect(require('../src/services/i18n').t('area.' + key, 'en')).not.toBe('area.' + key);
    }
  });
});
