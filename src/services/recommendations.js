// "Recommended for you": the events a senior can still book, scored 0-100 for them, best first, each with
// the reasons. This file only gathers the inputs (bookable events from nearby.js, the senior's history from
// recommendationData.js, distances from geo.js) and hands them to recommendationScoring.js, which does the
// scoring. Weights and tuning numbers are in config/recommendation.js.
//
//   const picks = await recommendForUser(req.user, { limit: 4 });
//   picks[0] -> { event, score, components, weights, reasons: [{ code, params }] }
//   reasonText(picks[0].reasons[0], req.t)  -> "You have been to 2 Fitness events before"
const { bookableEvents, nearbyEvents } = require('./nearby');
const { loadProfile } = require('./recommendationData');
const { scoreEvents, reasonText } = require('./recommendationScoring');
const { distanceKm, locationOf } = require('./geo');

// options: limit, now, config (overrides for config/recommendation.js),
//          events (bookable events already loaded, to save a second query)
// A senior who is not signed in, has no history or has no place still gets a list (see the scoring file).
async function recommendForUser(user, options = {}) {
  const now = options.now || new Date();
  const [candidates, profile] = await Promise.all([options.events || bookableEvents(user, now), loadProfile(user)]);

  const origin = locationOf(user);
  for (const event of candidates) {
    const spot = origin ? locationOf(event) : null;
    event.distanceKm = origin && spot ? Math.round(distanceKm(origin, spot) * 10) / 10 : null;
    event.distanceApproximate = Boolean(origin && spot && (origin.approximate || spot.approximate));
  }

  return scoreEvents(candidates, profile, { now, limit: options.limit, config: options.config });
}

const NEAR_KM = 15; // "near you" means this close or closer
// "recommended for you" needs a real reason: at least about one booking's worth of interest in the event's type
// (a booking is worth about 39 of 100, an attended event 53, a type they asked about 63; a page view alone, about 7)
const MIN_INTEREST = 25;

// The Find events deck for a signed-in senior: the events near them and the events picked for them come first, each
// marked (event.deckNotes = ['near'], ['recommended'] or both), then every other event in its usual order. Nothing is
// added or removed: it only changes the order, so filters, skips and places left are exactly as they were.
// "Recommended" is only used for events of a type they have shown interest in (joined, booked, or asked to hear about);
// before that the order is the usual one apart from the nearby events.
async function personalFirst(user, deck, { perKind = 4 } = {}) {
  if (!user || user.role !== 'senior' || deck.length === 0) return deck;

  const [picks, near] = await Promise.all([
    recommendForUser(user, { limit: perKind * 3, events: deck }),
    nearbyEvents(user, { limit: perKind * 3, events: deck })
  ]);
  const closest = near.located ? near.events.filter((e) => e.distanceKm !== null && e.distanceKm <= NEAR_KM).slice(0, perKind) : [];
  const picked = picks.filter((p) => p.components.interest !== null && p.components.interest >= MIN_INTEREST).slice(0, perKind).map((p) => p.event);

  // the nearest first, then the best pick, taking turns
  const front = [];
  const note = (event, kind) => {
    if (!front.includes(event)) front.push(event);
    event.deckNotes = (event.deckNotes || []).concat(event.deckNotes && event.deckNotes.includes(kind) ? [] : [kind]);
  };
  for (let i = 0; i < Math.max(closest.length, picked.length); i++) {
    if (closest[i]) note(closest[i], 'near');
    if (picked[i]) note(picked[i], 'recommended');
  }
  return front.concat(deck.filter((e) => !front.includes(e)));
}

module.exports = { recommendForUser, reasonText, bookableEvents, personalFirst, NEAR_KM };
