// Recommended for you: bookable events scored 0-100 for the senior, best first, with reasons.
// Only gathers inputs (nearby.js, recommendationData.js, geo.js) and hands them to recommendationScoring.js.
// Weights and tuning are in config/recommendation.js.
//
//   const picks = await recommendForUser(req.user, { limit: 4 });
//   picks[0] -> { event, score, components, weights, reasons: [{ code, params }] }
//   reasonText(picks[0].reasons[0], req.t)
const { bookableEvents, nearbyEvents } = require('./nearby');
const { loadProfile } = require('./recommendationData');
const { scoreEvents, reasonText } = require('./recommendationScoring');
const { distanceKm, locationOf } = require('./geo');

// options: limit, now, config (overrides config/recommendation.js), events (already loaded, saves a query)
// signed out, no history or no place still gets a list
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

const NEAR_KM = 15; // km
// "recommended" needs a real reason: about one booking of interest in the type
// (booking ~39, attended ~53, asked about ~63, a page view ~7)
const MIN_INTEREST = 25;

// Find events deck for a signed-in senior: near events and picked events come first, marked in event.deckNotes
// (['near'], ['recommended'] or both), then the rest in the usual order. Only reorders, filters and skips are untouched.
// "recommended" only for types they showed interest in (joined, booked, asked about).
async function personalFirst(user, deck, { perKind = 4 } = {}) {
  if (!user || user.role !== 'senior' || deck.length === 0) return deck;

  const [picks, near] = await Promise.all([
    recommendForUser(user, { limit: perKind * 3, events: deck }),
    nearbyEvents(user, { limit: perKind * 3, events: deck })
  ]);
  const closest = near.located ? near.events.filter((e) => e.distanceKm !== null && e.distanceKm <= NEAR_KM).slice(0, perKind) : [];
  const picked = picks.filter((p) => p.components.interest !== null && p.components.interest >= MIN_INTEREST).slice(0, perKind).map((p) => p.event);

  // nearest first, then best pick, taking turns
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
