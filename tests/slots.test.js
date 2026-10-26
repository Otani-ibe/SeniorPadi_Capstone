const request = require('supertest');
const app = require('../src/app');
const { Registration } = require('../src/models');
const capacity = require('../src/services/capacity');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function loggedInAgent(phone) {
  const agent = request.agent(app);
  await signIn(agent, phone);
  return agent;
}

// the text of the slots line for one event on a page, or '' when it is hidden
function slotsText(html, id) {
  const m = html.match(new RegExp('<p data-slots-for="' + id + '"[^>]*?(hidden)?>([^<]*)</p>'));
  return m ? m[2].trim() : null;
}

test('an event with 30 slots shows 30 slots left, and 29 after one senior registers', async () => {
  const event = await makeEvent({ capacity: 30 });
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('30 slots left');

  const senior = await makeUser();
  expect((await capacity.register(event.id, senior.id, 'attendee')).ok).toBe(true);
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('29 slots left');
});

test('the last slot reads 1 slot left, and a full event says capacity reached', async () => {
  const event = await makeEvent({ capacity: 2 });
  const a = await makeUser();
  const b = await makeUser();
  await capacity.register(event.id, a.id, 'attendee');
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('1 slot left');
  await capacity.register(event.id, b.id, 'attendee');
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('Capacity reached');
});

test('cancelling a registration gives the slot back', async () => {
  const event = await makeEvent({ capacity: 5 });
  const a = await makeUser();
  await capacity.register(event.id, a.id, 'attendee');
  await Registration.update({ status: 'cancelled' }, { where: { eventId: event.id, seniorId: a.id } });
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('5 slots left');
});

test('an event with no capacity shows nothing, and anyone can register', async () => {
  const event = await makeEvent({ capacity: null });
  const page = await request(app).get('/events/' + event.id);
  expect(slotsText(page.text, event.id)).toBe('');

  for (let i = 0; i < 12; i++) {
    const senior = await makeUser();
    expect((await capacity.register(event.id, senior.id, 'attendee')).ok).toBe(true);
  }
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('');
});

test('the home page and the Find events deck show the slots too', async () => {
  const event = await makeEvent({ title: 'Painting class', capacity: 18 });
  const home = await request(app).get('/');
  expect(slotsText(home.text, event.id)).toBe('18 slots left');
  const deck = await request(app).get('/events');
  expect(slotsText(deck.text, event.id)).toBe('18 slots left');
});

test('when the admin changes the capacity, the card follows', async () => {
  const admin = await makeUser({ role: 'admin' });
  const event = await makeEvent({ capacity: 10 });
  const seniors = [await makeUser(), await makeUser(), await makeUser()];
  for (const s of seniors) await capacity.register(event.id, s.id, 'attendee');
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('7 slots left');

  const agent = await loggedInAgent(admin.phone);
  const send = async (value) => {
    const form = await agent.get('/admin/events/' + event.id + '/edit');
    const body = {
      _csrf: csrfFrom(form.text), title: event.title, description: event.description,
      startsAt: new Date(event.startsAt.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16),
      endsAt: new Date(event.endsAt.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16),
      registrationDeadline: new Date(event.registrationDeadline.getTime()).toISOString().slice(0, 16),
      locationText: event.locationText, area: 'egbeda', category: event.category,
      organizationId: String(event.organizationId), capacity: value, pricing: 'free'
    };
    return agent.post('/admin/events/' + event.id + '/edit').type('form').send(body);
  };

  expect((await send('40')).status).toBe(302);                  // raise it
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('37 slots left');

  expect((await send('5')).status).toBe(302);                   // lower it
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('2 slots left');

  const tooLow = await send('2');                               // below the 3 already registered
  expect(tooLow.status).toBe(400);
  expect(tooLow.text).toMatch(/3 seniors are already registered/);

  expect((await send('')).status).toBe(302);                    // empty = no limit, nothing shown
  expect(slotsText((await request(app).get('/events/' + event.id)).text, event.id)).toBe('');
});

test('the live refresh endpoint returns the numbers, and null for an event with no limit', async () => {
  const limited = await makeEvent({ capacity: 4 });
  const open = await makeEvent({ capacity: null });
  const senior = await makeUser();
  await capacity.register(limited.id, senior.id, 'attendee');
  const res = await request(app).get('/events/slots.json?ids=' + limited.id + ',' + open.id + ',abc');
  expect(res.status).toBe(200);
  expect(res.body[limited.id]).toBe(3);
  expect(res.body[open.id]).toBeNull();
});
