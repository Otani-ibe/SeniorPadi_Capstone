// "Nearby events": the upcoming events a senior can still book, closest first.
//
//  - Only events that can be booked are used: published, not started, registration still open, and a
//    place left. Events the senior is already booked into are left out (as on the home page).
//  - Distance is the straight-line distance between the senior and the venue, in kilometres (geo.js).
//  - The search starts small and grows: if fewer than `minimum` events are within the first radius, the
//    next radius is tried, and so on, until there are enough or the radii run out (then all of Ibadan).
//  - Missing places are handled safely. A senior or an event without coordinates uses the middle of its
//    local government area (flagged `approximate`). A senior with no place at all gets the soonest events
//    with no distance (`located: false`). An event with no place at all is left out of the ranking.
// All the working is done here on the server; the page only shows the result.
const { Op } = require('sequelize');
const { Event, Organization, Registration } = require('../models');
const { placesLeftFor } = require('./recommend');
const { distanceKm, locationOf } = require('./geo');

const RADII_KM = [5, 10, 25, 50];
const POOL_SIZE = 300;

const round1 = (km) => Math.round(km * 10) / 10;

// events that can still be booked, soonest first, each with .slotsLeft (null = no limit)
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

// options: limit (how many to return), minimum (how many before the search stops growing),
//          radii (km, smallest first), now, events (bookable events already loaded, to save a second query)
// returns { events, located, approximate, radiusKm, expanded }
//   events        each has .distanceKm (null when the senior's place is unknown) and .slotsLeft
//   located       false when the senior's place is unknown (events are then soonest first)
//   approximate   true when the senior's place is only the middle of their area
//   radiusKm      the distance the list was cut at, or null when it is all of Ibadan
//   expanded      true when the first radius had too few events and the search grew
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
    if (!spot) continue; // a venue nobody can place cannot be ranked
    event.distanceKm = round1(distanceKm(origin, spot));
    event.distanceApproximate = origin.approximate || spot.approximate;
    placed.push(event);
  }
  // closest first; equal distances go to the soonest, and the pool was already soonest first
  placed.sort((a, b) => a.distanceKm - b.distanceKm || new Date(a.startsAt) - new Date(b.startsAt));

  let radiusKm = null;
  let chosen = placed;
  for (const radius of radii) {
    const within = placed.filter((e) => e.distanceKm <= radius);
    radiusKm = radius;
    chosen = within;
    if (within.length >= minimum) break;
    if (radius === radii[radii.length - 1]) { radiusKm = null; chosen = placed; } // still too few: all of Ibadan
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
