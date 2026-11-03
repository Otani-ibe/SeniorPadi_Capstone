// Find events deck for a signed-in senior: near and picked events first, with a small note
const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

const BODIJA = { latitude: 7.4322, longitude: 3.9136 };
const MOKOLA = { latitude: 7.4, longitude: 3.895 }; // about 4 km from Bodija
const FAR = { latitude: 7.2, longitude: 3.8 }; // about 30 km away

const later = (days) => ({ startsAt: new Date(Date.now() + days * DAY), endsAt: new Date(Date.now() + days * DAY + 3600000), registrationDeadline: new Date(Date.now() + (days - 0.5) * DAY) });
const earlier = (days) => ({ startsAt: new Date(Date.now() - days * DAY), endsAt: new Date(Date.now() - days * DAY + 3600000), registrationDeadline: new Date(Date.now() - (days + 1) * DAY) });
const event = (title, category, place, days, extra = {}) => makeEvent({ title, category, area: 'ibadan-north', geoSource: 'geocoded', ...place, ...later(days), ...extra });

async function agentFor(user) {
  const agent = request.agent(app);
  await signIn(agent, user.phone);
  return agent;
}

// the cards on the page, in order: [{ title, notes: ['near', 'recommended'] }]
function cards(html) {
  return html.split('<article').slice(1).map((chunk) => ({
    title: ((chunk.match(/<h2 class="text-\[1\.45rem\][^>]*>([^<]+)<\/h2>/) || [])[1] || '').trim(),
    notes: [...chunk.matchAll(/data-deck-note="(\w+)"/g)].map((m) => m[1])
  }));
}
const titles = (html) => cards(html).map((c) => c.title);

// a senior who has been to a fitness event, and a mixed set of upcoming ones, soonest first
async function seedEvents() {
  await event('Soonest far charity', 'charity', FAR, 1);
  await event('Next far charity', 'charity', FAR, 2);
  await event('Close fitness walk', 'fitness', MOKOLA, 5);
  await event('Far fitness class', 'fitness', FAR, 6);
}

test('near events and recommended events come first, each with its small note; everything else follows in order', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  const done = await event('Last month walk', 'fitness', MOKOLA, 1, earlier(20));
  await Registration.create({ eventId: done.id, seniorId: senior.id, type: 'attendee', status: 'attended' });
  await seedEvents();

  const page = await (await agentFor(senior)).get('/events');
  expect(page.status).toBe(200);
  const deck = cards(page.text);
  expect(deck.map((c) => c.title)).toEqual(['Close fitness walk', 'Far fitness class', 'Soonest far charity', 'Next far charity']);

  expect(deck[0].notes.sort()).toEqual(['near', 'recommended']); // close, and the kind they go to
  expect(deck[1].notes).toEqual(['recommended']); // far away, but their kind of event
  expect(deck[2].notes).toEqual([]); // everything else is as before, with no note
  expect(deck[3].notes).toEqual([]);
  expect(page.text).toContain('Near you');
  expect(page.text).toContain('Recommended for you');
});

test('a new senior with a place but no history sees nearby events first, and is not told anything is "recommended"', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  await seedEvents();
  const page = await (await agentFor(senior)).get('/events');
  const deck = cards(page.text);
  expect(deck[0]).toEqual({ title: 'Close fitness walk', notes: ['near'] });
  expect(deck.slice(1).map((c) => c.title)).toEqual(['Soonest far charity', 'Next far charity', 'Far fitness class']);
  expect(deck.every((c) => !c.notes.includes('recommended'))).toBe(true);
  expect(page.text).not.toContain('Recommended for you');
});

test('a senior with no place and no history sees the usual order with no notes', async () => {
  const senior = await makeUser();
  await seedEvents();
  const page = await (await agentFor(senior)).get('/events');
  expect(titles(page.text)).toEqual(['Soonest far charity', 'Next far charity', 'Close fitness walk', 'Far fitness class']);
  expect(cards(page.text).every((c) => c.notes.length === 0)).toBe(true);
});

test('a visitor sees the usual order with no notes', async () => {
  await seedEvents();
  const page = await request(app).get('/events');
  expect(titles(page.text)).toEqual(['Soonest far charity', 'Next far charity', 'Close fitness walk', 'Far fitness class']);
  expect(page.text).not.toContain('Near you');
});

test('only events that can be joined are in the deck: not ones already booked, skipped, full, cancelled or past', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  const other = await makeUser();
  const booked = await event('Already booked', 'fitness', MOKOLA, 3);
  await Registration.create({ eventId: booked.id, seniorId: senior.id, type: 'attendee', status: 'registered' });
  const full = await event('Full one', 'fitness', MOKOLA, 3, { capacity: 1 });
  await Registration.create({ eventId: full.id, seniorId: other.id, type: 'attendee', status: 'registered' });
  await event('Cancelled one', 'fitness', MOKOLA, 3, { status: 'cancelled' });
  await event('Past one', 'fitness', MOKOLA, 1, earlier(2));
  const skipMe = await event('Skipped one', 'fitness', MOKOLA, 3);
  await event('Good one', 'fitness', MOKOLA, 4);

  const agent = await agentFor(senior);
  const first = await agent.get('/events');
  await agent.post('/events/' + skipMe.id + '/skip').type('form').send({ _csrf: csrfFrom(first.text), category: '', area: 'all' });
  expect(titles((await agent.get('/events')).text)).toEqual(['Good one']);
});

test('the filters still decide what is shown; the notes only reorder it', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  await seedEvents();
  const page = await (await agentFor(senior)).get('/events?category=charity&area=all');
  expect(titles(page.text).sort()).toEqual(['Next far charity', 'Soonest far charity']);
  const search = await (await agentFor(senior)).get('/events?area=all&q=Close');
  expect(titles(search.text)).toEqual(['Close fitness walk']);
  expect(cards(search.text)[0].notes).toContain('near');
});

test('the deck holds exactly the same events with or without the notes', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  for (let i = 0; i < 12; i++) await event('Event ' + i, ['fitness', 'faith', 'social'][i % 3], i % 2 ? MOKOLA : FAR, 2 + i);
  const mine = titles((await (await agentFor(senior)).get('/events')).text);
  const visitor = titles((await request(app).get('/events')).text);
  expect(mine).toHaveLength(12);
  expect(new Set(mine).size).toBe(12);
  expect(mine.slice().sort()).toEqual(visitor.slice().sort());
});

test('a card from the personal part of the deck registers like any other', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  const walk = await event('Close fitness walk', 'fitness', MOKOLA, 3);
  const agent = await agentFor(senior);
  const page = await agent.get('/events');
  expect(page.text).toContain('/events/' + walk.id + '/register');
  const res = await agent.post('/events/' + walk.id + '/register').type('form').send({ _csrf: csrfFrom(page.text) });
  expect(res.headers.location).toBe('/events/' + walk.id + '/registered');
  expect(await Registration.count({ where: { eventId: walk.id, seniorId: senior.id, status: 'registered' } })).toBe(1);
});

test('the separate "Events for you" page, its links and the "why" boxes are gone', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north' });
  await seedEvents();
  const agent = await agentFor(senior);
  expect((await agent.get('/for-you')).status).toBe(404);
  for (const url of ['/', '/account', '/events']) {
    const page = await agent.get(url);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('/for-you');
    expect(page.text).not.toContain('Events near me and for me');
    expect(page.text).not.toContain('Why you might like it');
  }
});

test('the notes are in Yorùbá too', async () => {
  const senior = await makeUser({ ...BODIJA, lga: 'ibadan-north', preferredLanguage: 'yo' });
  await seedEvents();
  const page = await (await agentFor(senior)).get('/events');
  expect(page.text).toContain('Nítòsí yín');
  expect(page.text).not.toMatch(/\bdeck\.(near|recommended)\b/);
});
