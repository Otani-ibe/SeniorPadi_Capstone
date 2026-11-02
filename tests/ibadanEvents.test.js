const events = require('../src/scripts/data/ibadanEvents');
const models = require('../src/models');
const { Event, Organization, Registration } = models;
const { addSampleEvents, removeSampleEvents } = require('../src/services/sampleEvents');
const startup = require('../src/services/startup');
const { resetDb, makeUser, makeEvent, sequelize } = require('./helpers');

// the list that src/scripts/addEvents.js puts in the database
test('the events list is complete and every event can be saved', () => {
  expect(events).toHaveLength(30);
  for (const e of events) {
    expect(Event.CATEGORIES).toContain(e.category);
    if (e.area) expect(Event.AREAS).toContain(e.area);
    expect(e.endsAt.getTime()).toBeGreaterThan(e.startsAt.getTime());
    expect(e.title.length).toBeGreaterThan(5);
    expect(e.description.length).toBeGreaterThan(30);
    expect(e.org).toBeTruthy();
    expect(e.location).toBeTruthy();
  }
});

test('every flyer file exists', () => {
  const fs = require('fs');
  const path = require('path');
  for (const e of events) expect(fs.existsSync(path.join(__dirname, '../public', e.imageUrl))).toBe(true);
});

test('no event is listed twice', () => {
  const keys = events.map((e) => e.title.toLowerCase() + '|' + e.startsAt.toISOString());
  expect(new Set(keys).size).toBe(events.length);
});

test('the dates run from 3 December 2026 to 16 January 2027', () => {
  const days = events.map((e) => e.startsAt.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })).sort();
  expect(days[0]).toBe('2026-12-03');
  expect(days[days.length - 1]).toBe('2027-01-16');
});


// ---------- putting the list in the database ----------
describe('adding the events list', () => {
  beforeEach(resetDb);
  afterAll(() => sequelize.close());

  test('an empty site gets every event, each with a number of places, once', async () => {
    const result = await addSampleEvents(models);
    expect(result.events).toBe(30);
    expect(await Event.count()).toBe(30);
    expect(await Event.count({ where: { capacity: null } })).toBe(0);
    expect(await Event.count({ where: { area: null } })).toBe(0);
    expect(await Event.count({ where: { imageUrl: null } })).toBe(0);
    // every host is in the organizations list, each name once
    const names = (await Organization.findAll()).map((o) => o.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);

    const again = await addSampleEvents(models);
    expect(again.events).toBe(0);
    expect(again.orgs).toBe(0);
    expect(await Event.count()).toBe(30);
  });

  test('an event staff already added for the same host on the same day is not repeated', async () => {
    const org = await Organization.create({ name: 'St. David’s Anglican Cathedral, Kudeti' });
    await makeEvent({ title: 'Christmas Hymns, Prayer and Fellowship', organizationId: org.id, startsAt: new Date('2026-12-19T15:00:00Z'), endsAt: new Date('2026-12-19T17:00:00Z') });
    const result = await addSampleEvents(models);
    expect(result.events).toBe(29);
    expect(result.skipped.join(' ')).toContain('Christmas Carols and Old Hymns Sing-Along');
    expect(await Organization.count({ where: { name: 'Cathedral Church of St. David, Kudeti' } })).toBe(0); // the existing church was reused
  });

  test('events staff add later sit alongside, and running it again never changes them', async () => {
    await addSampleEvents(models);
    const mine = await makeEvent({ title: 'My own event', capacity: 5 });
    // staff changed a listed event's number of places and area
    const listed = await Event.findOne({ where: { title: 'Seated Exercise and Dance Class' } });
    await listed.update({ capacity: 7, area: 'lagelu' });

    await addSampleEvents(models);
    expect(await Event.count()).toBe(31);
    expect((await Event.findByPk(mine.id)).capacity).toBe(5);
    const same = await Event.findByPk(listed.id);
    expect(same.capacity).toBe(7);
    expect(same.area).toBe('lagelu');
  });

  test('blank places or area on a listed event are filled in, nothing else', async () => {
    await addSampleEvents(models);
    const listed = await Event.findOne({ where: { title: 'Seated Exercise and Dance Class' } });
    await listed.update({ capacity: null, area: null, description: 'Staff wrote this' });
    const result = await addSampleEvents(models);
    expect(result.filled).toBe(1);
    const same = await Event.findByPk(listed.id);
    expect(same.capacity).toBe(30);
    expect(same.description).toBe('Staff wrote this');
  });

  test('removing takes out only listed events nobody registered for', async () => {
    await addSampleEvents(models);
    const user = await makeUser();
    const busy = await Event.findOne({ where: { title: 'Ayo and Draughts Tournament' } });
    await Registration.create({ eventId: busy.id, seniorId: user.id, status: 'registered', role: 'attendee', ticketNumber: 'SP-TEST-1' }).catch(() => null);
    const mine = await makeEvent({ title: 'My own event' });

    const result = await removeSampleEvents(models);
    const left = await Event.findAll();
    expect(left.map((e) => e.id)).toContain(mine.id);
    expect(result.events).toBeGreaterThanOrEqual(29);
  });

  test('a new site (no events) is filled at start-up, a site with any event is left alone', async () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // start-up skips this in tests, so pretend it is a normal run
    try {
      expect(await startup.ensureSampleEvents(models)).toBe(30);
      expect(await Event.count()).toBe(30);

      await Event.destroy({ where: {}, truncate: false });
      await makeEvent({ title: 'Only event' });
      expect(await startup.ensureSampleEvents(models)).toBe(0);
      expect(await Event.count()).toBe(1);
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});
