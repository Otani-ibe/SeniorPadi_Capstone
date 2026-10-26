const bcrypt = require('bcrypt');
const { sequelize, User, Organization, Event } = require('../src/models');
const { normalizePhone } = require('../src/services/phone');
const { lastCodeForTests } = require('../src/services/verification');

const DAY = 24 * 60 * 60 * 1000;

async function resetDb() {
  await sequelize.sync({ force: true });
}

let phoneCounter = 100;
async function makeUser(extra = {}) {
  phoneCounter++;
  return User.create({
    fullName: 'Test Senior ' + phoneCounter,
    phone: '+2348031000' + phoneCounter,
    passwordHash: await bcrypt.hash('password123', 4),
    ageDeclared: true,
    phoneVerifiedAt: new Date(), // most tests assume a confirmed phone
    ...extra
  });
}

async function makeEvent(extra = {}) {
  const org = await Organization.create({ name: 'Test Org' });
  return Event.create({
    title: 'Test event',
    description: 'Something nice',
    startsAt: new Date(Date.now() + 3 * DAY),
    endsAt: new Date(Date.now() + 3 * DAY + 2 * 60 * 60 * 1000),
    registrationDeadline: new Date(Date.now() + 2 * DAY),
    locationText: 'Somewhere in Ibadan',
    category: 'fitness',
    organizationId: org.id,
    capacity: 10,
    ...extra
  });
}

// pulls the csrf token out of a page
function csrfFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

// signs in the way a person does: phone number, then the code we texted them
// (staff accounts type their password instead). extra = e.g. { registerEventId }.
// Returns the last response.
async function signIn(agent, phone, extra = {}) {
  const page = await agent.get('/login');
  const first = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), phone, ...extra });

  if (first.headers.location === '/login/password') {
    const form = await agent.get('/login/password');
    return agent.post('/login/password').type('form').send({ _csrf: csrfFrom(form.text), password: 'password123' });
  }
  if (first.headers.location === '/login/code') {
    const user = await User.findOne({ where: { phone: normalizePhone(phone) } });
    const form = await agent.get('/login/code');
    return agent.post('/login/code').type('form').send({ _csrf: csrfFrom(form.text), code: lastCodeForTests(user.id) });
  }
  return first;
}

module.exports = { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY };
