// The events on the home page.
// A signed-in senior gets recommendations: events like the ones they joined before first (same type,
// same host). A visitor gets the upcoming events, soonest first.
// Only events that can still be booked are used. No AI: just counting what they joined before.
const { Op } = require('sequelize');
const { Event, Organization, Registration } = require('../models');
const capacity = require('./capacity');

const POOL_SIZE = 60;

// seats left for each event id, in one query
async function placesLeftFor(events) {
  if (events.length === 0) return {};
  const rows = await Registration.findAll({
    attributes: ['eventId', [Registration.sequelize.fn('COUNT', '*'), 'total']],
    where: { eventId: events.map((e) => e.id), type: 'attendee', status: { [Op.in]: capacity.SEAT_STATUSES } },
    group: ['eventId'],
    raw: true
  });
  const taken = {};
  for (const row of rows) taken[row.eventId] = Number(row.total);
  const left = {};
  // null = the event has no limit
  for (const e of events) left[e.id] = e.capacity == null ? null : Math.max(0, e.capacity - (taken[e.id] || 0));
  return left;
}

// events ranked for one senior. history = the events they joined before ({ category, organizationId }).
// Pure function, so it's easy to test: more of the same type or host scores higher, ties go to the soonest.
function rankEvents(candidates, history) {
  const byCategory = {};
  const byHost = {};
  for (const h of history) {
    byCategory[h.category] = (byCategory[h.category] || 0) + 1;
    byHost[h.organizationId] = (byHost[h.organizationId] || 0) + 1;
  }
  const score = (e) => 3 * (byCategory[e.category] || 0)
    + 2 * (byHost[e.organizationId] || 0);

  return candidates.slice().sort((a, b) => score(b) - score(a) || new Date(a.startsAt) - new Date(b.startsAt));
}

// returns up to `limit` events (soonest first for a visitor), each with .slotsLeft (null when there is no limit)
async function recommendedEvents(user, limit = 4) {
  const now = new Date();
  let pool = await Event.findAll({
    where: { status: 'published', startsAt: { [Op.gt]: now }, registrationDeadline: { [Op.gt]: now } },
    include: [Organization],
    order: [['startsAt', 'ASC']],
    limit: POOL_SIZE
  });

  const left = await placesLeftFor(pool);
  pool = pool.filter((e) => left[e.id] === null || left[e.id] > 0);
  pool.forEach((e) => { e.slotsLeft = left[e.id]; });

  if (!user) return pool.slice(0, limit); // the pool is already soonest first

  // what they joined before (cancelled ones don't count as taste), and what they're already booked into
  const regs = await Registration.findAll({
    where: { seniorId: user.id, type: 'attendee', status: { [Op.in]: ['registered', 'attended', 'no_show'] } },
    attributes: ['eventId', 'status']
  });
  const pastEvents = regs.length
    ? await Event.findAll({ where: { id: regs.map((r) => r.eventId) }, attributes: ['id', 'category', 'organizationId'] })
    : [];
  const bookedNow = new Set(regs.filter((r) => r.status === 'registered').map((r) => r.eventId));

  const fresh = pool.filter((e) => !bookedNow.has(e.id));
  return rankEvents(fresh, pastEvents).slice(0, limit);
}

module.exports = { recommendedEvents, rankEvents };
