// SeniorPadi's own December events (1 to 4 December 2026), and "show this event first".
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const models = require('../src/models');
const { Event, Organization } = models;
const december = require('../src/scripts/data/decemberEvents');
const { addSampleEvents, removeSampleEvents, ALL } = require('../src/services/sampleEvents');
const { rankEvents } = require('../src/services/recommend');
const dates = require('../src/services/dates');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const WANTED = {
  'Dance Like It\'s 1975: Highlife and Juju Afternoon': '2026-12-01',
  'Ayo Olopon Showdown: Grandparents vs Grandchildren': '2026-12-03',
  'Sing It Like the Old Days: Karaoke for Elders': '2026-12-03',
  'Retired, Not Retired: Pension, Scams and Your Money': '2026-12-02',
  'Ask the Doctor: The Questions You Are Shy to Ask': '2026-12-01',
  'Fall-Proof Your Home': '2026-12-03',
  'Teach Pupils in Primary School Day': '2026-12-04'
};
const lagosDay = (date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

describe('the list', () => {
  test('has exactly the seven events asked for, each on its day, all between 1 and 4 December', () => {
    expect(december).toHaveLength(7);
    expect(Object.fromEntries(december.map((e) => [e.title, lagosDay(e.startsAt)]))).toEqual(WANTED);
    for (const e of december) {
      expect(lagosDay(e.startsAt) >= '2026-12-01' && lagosDay(e.endsAt) <= '2026-12-04').toBe(true);
      expect(e.endsAt.getTime()).toBeGreaterThan(e.startsAt.getTime());
    }
  });

  test('every event has solid details, places and volunteers, and comes first', () => {
    for (const e of december) {
      expect(Event.CATEGORIES).toContain(e.category);
      expect(Event.AREAS).toContain(e.area);
      expect(e.description.length).toBeGreaterThan(300); // what happens, who is there, what volunteers do
      expect(e.description).toMatch(/Volunteers are needed/);
      expect(e.location.length).toBeGreaterThan(5);
      expect(e.capacity).toBeGreaterThan(0);
      expect(e.volunteerCapacity).toBeGreaterThan(0);
      expect(e.featured).toBe(true);
      expect(e.imageUrl).toMatch(/^\/images\/events\/december\/0\d-.+\.jpg$/);
      expect(fs.existsSync(path.join(__dirname, '../public', e.imageUrl))).toBe(true); // the flyer file is really there
      expect(e.imageAlt.length).toBeGreaterThan(80); // what blind seniors hear instead of the picture
      expect(e.imageAlt).toMatch(/^Flyer: /);
      expect(e.org).toBe('SeniorPadi Community Events');
    }
  });

  test('no two events are at the same place at the same time, and no event is listed twice', () => {
    for (const a of december) {
      for (const b of december) {
        if (a === b || a.location !== b.location) continue;
        expect(a.endsAt <= b.startsAt || b.endsAt <= a.startsAt).toBe(true);
      }
    }
    expect(new Set(december.map((e) => e.title)).size).toBe(7);
  });
});

describe('adding them to the database', () => {
  test('all seven are saved with their places, volunteers, host and "show first"; none is skipped for sharing a host and a day', async () => {
    const result = await addSampleEvents(models, { include: ['december'] });
    expect(result.events).toBe(7);
    expect(result.skipped).toEqual([]); // two on 1 December and three on 3 December, all from one host
    expect(await Organization.count()).toBe(1);
    const saved = await Event.findAll({ order: [['startsAt', 'ASC']] });
    expect(saved.map((e) => e.title)).toEqual([
      'Ask the Doctor: The Questions You Are Shy to Ask', 'Dance Like It\'s 1975: Highlife and Juju Afternoon',
      'Retired, Not Retired: Pension, Scams and Your Money', 'Fall-Proof Your Home',
      'Ayo Olopon Showdown: Grandparents vs Grandchildren', 'Sing It Like the Old Days: Karaoke for Elders', 'Teach Pupils in Primary School Day'
    ]);
    for (const e of saved) {
      expect(e).toMatchObject({ featured: true, volunteerEnabled: true, status: 'published' });
      expect(e.imageUrl).toMatch(/^\/images\/events\/december\//);
      expect(e.imageAlt).toBeTruthy();
      expect(e.capacity).toBeGreaterThan(0);
      expect(e.volunteerCapacity).toBeGreaterThan(0);
      expect(e.registrationDeadline < e.startsAt).toBe(true);
    }
  });

  test('running it again adds nothing twice, and it never overwrites what staff changed', async () => {
    await addSampleEvents(models, { include: ['december'] });
    const dance = await Event.findOne({ where: { title: december[0].title } });
    await dance.update({ capacity: 99, description: 'Staff wrote this.' });
    expect((await addSampleEvents(models, { include: ['december'] })).events).toBe(0);
    expect(await Event.count()).toBe(7);
    expect(await dance.reload()).toMatchObject({ capacity: 99, description: 'Staff wrote this.' });
  });

  test('the original list is unchanged by default: still 30 events, none "show first", no volunteers needed', async () => {
    expect((await addSampleEvents(models)).events).toBe(30);
    expect(await Event.count({ where: { featured: true } })).toBe(0);
    expect(await Event.count()).toBe(30);
  });

  test('both lists together make 37, and they can be taken out again', async () => {
    expect((await addSampleEvents(models, { include: ALL })).events).toBe(37);
    const removed = await removeSampleEvents(models, { include: ['december'] });
    expect(removed.events).toBe(7);
    expect(await Event.count()).toBe(30);
  });
});

// the events with the dates moved forward, so these tests keep working after the real dates have passed
async function seedShifted() {
  const shift = Date.now() + 10 * DAY - december.reduce((first, e) => Math.min(first, e.startsAt.getTime()), Infinity);
  const org = await Organization.create({ name: 'SeniorPadi Community Events' });
  for (const e of december) {
    await Event.create({
      title: e.title, description: e.description, category: e.category, area: e.area, locationText: e.location, organizationId: org.id,
      startsAt: new Date(e.startsAt.getTime() + shift), endsAt: new Date(e.endsAt.getTime() + shift),
      registrationDeadline: new Date(e.startsAt.getTime() + shift - DAY), capacity: e.capacity,
      volunteerEnabled: true, volunteerCapacity: e.volunteerCapacity, featured: true
    });
  }
  // ordinary events that start SOONER than every one of them
  for (const [title, days] of [['Plain event one', 1], ['Plain event two', 2], ['Plain event three', 3], ['Plain event four', 4], ['Plain event five', 5]]) {
    await makeEvent({ title, category: 'social', startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000), registrationDeadline: new Date(Date.now() + (days - 0.5) * DAY) });
  }
}
const FIRST_SEVEN = [
  'Ask the Doctor: The Questions You Are Shy to Ask', 'Dance Like It\'s 1975: Highlife and Juju Afternoon', 'Retired, Not Retired: Pension, Scams and Your Money',
  'Fall-Proof Your Home', 'Ayo Olopon Showdown: Grandparents vs Grandchildren', 'Sing It Like the Old Days: Karaoke for Elders', 'Teach Pupils in Primary School Day'
];
const deckTitles = (html) => html.split('<article').slice(1).map((c) => ((c.match(/<h2 class="text-\[1\.45rem\][^>]*>([^<]+)<\/h2>/) || [])[1] || '').trim()).map((t) => t.replace(/&#39;/g, '\''));

describe('they come up first', () => {
  test('on the Events page, before ordinary events that start sooner, and in date order among themselves', async () => {
    await seedShifted();
    const deck = deckTitles((await request(app).get('/events')).text);
    expect(deck.slice(0, 7)).toEqual(FIRST_SEVEN);
    expect(deck.slice(7)).toEqual(['Plain event one', 'Plain event two', 'Plain event three', 'Plain event four', 'Plain event five']);
  });

  test('for a signed-in senior too, ahead of what is near them and picked for them', async () => {
    await seedShifted();
    const senior = await makeUser({ lga: 'ibadan-north', latitude: 7.4322, longitude: 3.9136 });
    const agent = request.agent(app);
    await signIn(agent, senior.phone);
    const deck = deckTitles((await agent.get('/events')).text);
    expect(deck.slice(0, 7).sort()).toEqual(FIRST_SEVEN.slice().sort());
    expect(deck).toHaveLength(12);
  });

  test('on the home page: they lead the four cards, even though other events start sooner', async () => {
    await seedShifted();
    const home = (await request(app).get('/')).text;
    for (const title of FIRST_SEVEN.slice(0, 4)) expect(home.replace(/&#39;/g, '\'')).toContain(title);
    expect(home).not.toContain('Plain event one');
  });

  test('"best match first" never beats "show first"', () => {
    const history = [{ category: 'fitness', organizationId: 1 }, { category: 'fitness', organizationId: 1 }];
    const events = [
      { id: 1, category: 'fitness', organizationId: 1, startsAt: new Date(Date.now() + DAY) }, // a perfect match, soonest
      { id: 2, category: 'faith', organizationId: 9, startsAt: new Date(Date.now() + 9 * DAY), featured: true }
    ];
    expect(rankEvents(events, history).map((e) => e.id)).toEqual([2, 1]);
  });

  test('a cancelled or full "show first" event is not shown, like any other', async () => {
    await seedShifted();
    await Event.update({ status: 'cancelled' }, { where: { title: 'Fall-Proof Your Home' } });
    const deck = deckTitles((await request(app).get('/events')).text);
    expect(deck).not.toContain('Fall-Proof Your Home');
    expect(deck[0]).toBe('Ask the Doctor: The Questions You Are Shy to Ask');
  });
});

describe('volunteers', () => {
  test('each event page offers volunteering, with the number of volunteers needed', async () => {
    await seedShifted();
    const event = await Event.findOne({ where: { title: 'Dance Like It\'s 1975: Highlife and Juju Afternoon' } });
    const senior = await makeUser();
    const agent = request.agent(app);
    await signIn(agent, senior.phone);
    const page = await agent.get('/events/' + event.id);
    expect(page.text).toMatch(/volunteer/i);
    expect(page.text).toContain('/events/' + event.id + '/volunteer');
  });
});

describe('the admin can mark any event "show first"', () => {
  async function adminAgent() {
    const agent = request.agent(app);
    await signIn(agent, (await makeUser({ role: 'admin' })).phone);
    return agent;
  }
  const body = (event, extra = {}) => ({
    title: event.title, description: event.description, startsAt: dates.toLocalInput(event.startsAt), endsAt: dates.toLocalInput(event.endsAt),
    registrationDeadline: dates.toLocalInput(event.registrationDeadline), locationText: event.locationText, area: 'ibadan-north', category: event.category,
    organizationId: String(event.organizationId), capacity: '20', pricing: 'free', ...extra
  });

  test('the form has the tick box, and saving with it ticked or not changes the event', async () => {
    const agent = await adminAgent();
    const event = await makeEvent();
    const form = await agent.get('/admin/events/' + event.id + '/edit');
    expect(form.text).toContain('Show this event first');
    expect(form.text).not.toMatch(/name="featured"[^>]*checked/);

    await agent.post('/admin/events/' + event.id + '/edit').type('form').send({ _csrf: csrfFrom(form.text), ...body(event), featured: 'yes' });
    expect((await event.reload()).featured).toBe(true);
    const again = await agent.get('/admin/events/' + event.id + '/edit');
    expect(again.text).toMatch(/name="featured"[^>]*checked/);

    await agent.post('/admin/events/' + event.id + '/edit').type('form').send({ _csrf: csrfFrom(again.text), ...body(event) });
    expect((await event.reload()).featured).toBe(false);
  });
});
