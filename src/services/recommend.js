// Events on the home page. Signed in: events like ones they joined (same type, same host) first. Visitor: soonest first.
// bookable events only. No AI, just counting past joins
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

// events ranked for one senior. history = events they joined ({ category, organizationId }).
// pure: same type or host scores higher, ties go to the soonest
function rankEvents(candidates, history) {
  const byCategory = {};
  const byHost = {};
  for (const h of history) {
    byCategory[h.category] = (byCategory[h.category] || 0) + 1;
    byHost[h.organizationId] = (byHost[h.organizationId] || 0) + 1;
  }
  const score = (e) => 3 * (byCategory[e.category] || 0)
    + 2 * (byHost[e.organizationId] || 0);

  // events marked "show first" always lead, then the best match, then the soonest
  const lead = (e) => (e.featured ? 1 : 0);
  return candidates.slice().sort((a, b) => lead(b) - lead(a) || score(b) - score(a) || new Date(a.startsAt) - new Date(b.startsAt));
}

// returns up to `limit` events (soonest first for a visitor), each with .slotsLeft (null when there is no limit)
async function recommendedEvents(user, limit = 4) {
  const now = new Date();
  let pool = await Event.findAll({
    where: { status: 'published', startsAt: { [Op.gt]: now }, registrationDeadline: { [Op.gt]: now } },
    include: [Organization],
    order: [['featured', 'DESC'], ['startsAt', 'ASC']], // "show first" leads
    limit: POOL_SIZE
  });

  const left = await placesLeftFor(pool);
  pool = pool.filter((e) => left[e.id] === null || left[e.id] > 0);
  pool.forEach((e) => { e.slotsLeft = left[e.id]; });

  if (!user) return pool.slice(0, limit); // pool is already soonest first

  // what they joined (cancelled isn't taste) and what they're already booked into
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

module.exports = { recommendedEvents, rankEvents, placesLeftFor };
