// Nearby events: bookable upcoming events, closest first.
// bookable = published, not started, registration open, a place left. Events the senior already holds are left out.
// distance is straight-line km (geo.js). The search starts at the first radius and widens until `minimum` events, then all of Ibadan.
// no coordinates -> centre of the LGA (approximate). Senior with no place -> soonest events, no distance (located: false).
// event with no place -> left out.
const { Op } = require('sequelize');
const { Event, Organization, Registration } = require('../models');
const { placesLeftFor } = require('./recommend');
const { distanceKm, locationOf } = require('./geo');

const RADII_KM = [5, 10, 25, 50];
const POOL_SIZE = 300;

const round1 = (km) => Math.round(km * 10) / 10;

// bookable events, soonest first, .slotsLeft (null = no limit)
async function bookableEvents(user, now) {
  let pool = await Event.findAll({
    where: { status: 'published', startsAt: { [Op.gt]: now }, registrationDeadline: { [Op.gt]: now } },
    include: [Organization],
    order: [['startsAt', 'ASC']],
    limit: POOL_SIZE
  });

  const left = await placesLeftFor(pool);
  pool = pool.filter((e) => left[e.id] === null || left[e.id] > 0);
  pool.forEach((e) => { e.slotsLeft = left[e.id]; });

  if (user && pool.length > 0) {
    const booked = await Registration.findAll({
      where: { seniorId: user.id, type: 'attendee', status: 'registered', eventId: pool.map((e) => e.id) },
      attributes: ['eventId']
    });
    const bookedIds = new Set(booked.map((r) => r.eventId));
    pool = pool.filter((e) => !bookedIds.has(e.id));
  }
  return pool;
}

// options: limit, minimum (stop widening at this many), radii (km, smallest first), now, events (already loaded, saves a query)
// -> { events, located, approximate, radiusKm, expanded }
//   events: .distanceKm (null if the senior's place is unknown), .slotsLeft
//   located: false when the senior's place is unknown
//   approximate: the senior's place is only the LGA centre
//   radiusKm: cut-off, null = all of Ibadan
//   expanded: the first radius had too few
async function nearbyEvents(user, options = {}) {
  const { limit = 6, minimum = 3, radii = RADII_KM, now = new Date() } = options;
  const pool = options.events || await bookableEvents(user, now);

  const origin = locationOf(user);
  if (!origin) {
    pool.forEach((e) => { e.distanceKm = null; });
    return { events: pool.slice(0, limit), located: false, approximate: false, radiusKm: null, expanded: false };
  }

  const placed = [];
  for (const event of pool) {
    const spot = locationOf(event);
    if (!spot) continue; // no place, can't rank
    event.distanceKm = round1(distanceKm(origin, spot));
    event.distanceApproximate = origin.approximate || spot.approximate;
    placed.push(event);
  }
  // closest first, ties soonest (the pool is already soonest first)
  placed.sort((a, b) => a.distanceKm - b.distanceKm || new Date(a.startsAt) - new Date(b.startsAt));

  let radiusKm = null;
  let chosen = placed;
  for (const radius of radii) {
    const within = placed.filter((e) => e.distanceKm <= radius);
    radiusKm = radius;
    chosen = within;
    if (within.length >= minimum) break;
    if (radius === radii[radii.length - 1]) { radiusKm = null; chosen = placed; } // still too few, so all of Ibadan
  }

  return {
    events: chosen.slice(0, limit),
    located: true,
    approximate: origin.approximate,
    radiusKm,
    expanded: radii.length > 0 && radiusKm !== radii[0]
  };
}

module.exports = { nearbyEvents, bookableEvents, RADII_KM };
