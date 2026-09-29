const bcrypt = require('bcrypt');
const { sequelize, User, Organization, Event } = require('../src/models');

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

module.exports = { resetDb, makeUser, makeEvent, csrfFrom, sequelize, DAY };
