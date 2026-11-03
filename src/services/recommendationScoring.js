// Scores events for one senior, 0 to 100, and says why. Pure functions: numbers in, numbers out, so it is
// easy to test. No database, no requests, no clock (the time is passed in). All weights and tuning numbers
// come from config/recommendation.js. The queries that feed it are in recommendationData.js.
//
// Five parts, each scored 0-100, then combined with the weights:
//   interest      how well the event's category matches what the senior chose and has joined before
//   proximity     how close the venue is
//   interactions  whether they have joined this host organization before
//   freshness     starting soon, newly listed, and places left
//   diversity     a type that is new to them, and not the same type again and again in the list
//
// Not double-counting: one past event adds points once, at its strongest state (attended beats booked
// beats no-show), to its category and to its host. A "tell me about this type" request made from an event
// they also booked adds nothing more, and a view of an event they booked or attended adds nothing.
//
// A part we know nothing about (a new senior has no history; a senior with no place has no distance) is
// left out and the others share its weight, so a new senior is not marked down for having no past.
const { resolveConfig } = require('../config/recommendation');

const DAY = 24 * 60 * 60 * 1000;
const PARTS = ['interest', 'proximity', 'interactions', 'freshness', 'diversity'];

const clamp = (n, low = 0, high = 100) => Math.min(high, Math.max(low, n));
const round1 = (n) => Math.round(n * 10) / 10;
const ms = (date) => (date instanceof Date ? date.getTime() : new Date(date).getTime());

// points -> 0-100, gaining less with each extra point and never passing 100
function saturate(points, config) {
  return 100 * (1 - Math.exp(-points / config.saturation));
}

function statusPoints(status, config) {
  return {
    attended: config.signals.attended,
    registered: config.signals.registered,
    no_show: config.signals.noShow,
    cancelled: config.signals.cancelled
  }[status] || 0;
}

// What we know about a senior, worked out once.
// profile = {
//   history:   [{ eventId, category, organizationId, startsAt, status }]   their bookings (status as in Registration)
//   interests: [{ category, sourceEventId }]                              "tell me about this type" requests
//   views:     [{ eventId, category, count }]                             passive views (none are recorded yet)
// }
function analyseProfile(profile = {}, options = {}) {
  const config = options.config || resolveConfig();
  const now = ms(options.now || new Date());

  // one entry per event, at its strongest state
  const strongest = new Map();
  for (const item of profile.history || []) {
    const kept = strongest.get(item.eventId);
    if (!kept || statusPoints(item.status, config) > statusPoints(kept.status, config)) strongest.set(item.eventId, item);
  }

  const categoryPoints = {};
  const hostPoints = {};
  const attended = {}; // category -> number of events attended
  const booked = {}; // category -> number of events booked (not attended, not given up)
  const add = (bucket, key, points) => { bucket[key] = (bucket[key] || 0) + points; };

  for (const item of strongest.values()) {
    const base = statusPoints(item.status, config);
    if (base <= 0) continue;
    const ageDays = Math.max(0, (now - ms(item.startsAt)) / DAY);
    const points = base * Math.pow(0.5, ageDays / config.halfLifeDays);
    add(categoryPoints, item.category, points);
    add(hostPoints, item.organizationId, points);
    if (item.status === 'attended') add(attended, item.category, 1);
    else add(booked, item.category, 1);
  }

  // asked to hear about a type: counts once per type, and not at all again when it came from an event already counted above
  const chosen = new Set();
  for (const interest of profile.interests || []) {
    if (chosen.has(interest.category)) continue;
    chosen.add(interest.category);
    const alreadyCounted = interest.sourceEventId != null && strongest.has(interest.sourceEventId)
      && statusPoints(strongest.get(interest.sourceEventId).status, config) > 0;
    if (!alreadyCounted) add(categoryPoints, interest.category, config.signals.explicitInterest);
  }

  // passive views: least valuable, capped, and ignored for events already counted as a booking
  const viewsByEvent = new Map();
  for (const view of profile.views || []) {
    if (strongest.has(view.eventId) && statusPoints(strongest.get(view.eventId).status, config) > 0) continue;
    const row = viewsByEvent.get(view.eventId) || { category: view.category, count: 0 };
    row.count += view.count == null ? 1 : view.count;
    viewsByEvent.set(view.eventId, row);
  }
  const viewPoints = {};
  for (const row of viewsByEvent.values()) add(viewPoints, row.category, row.count * config.signals.viewed);
  for (const [category, points] of Object.entries(viewPoints)) add(categoryPoints, category, Math.min(points, config.signals.viewedCap));

  const hasSignals = Object.values(categoryPoints).some((p) => p > 0);
  return { categoryPoints, hostPoints, attended, booked, chosen, hasSignals };
}

// ---------- the five parts, each 0-100 (or null = not known) ----------

function interestScore(event, prefs, config) {
  if (!prefs.hasSignals) return null;
  return saturate(prefs.categoryPoints[event.category] || 0, config);
}

function proximityScore(event, config) {
  const km = event.distanceKm;
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return null;
  const { fullScoreKm, zeroKm } = config.proximity;
  if (km <= fullScoreKm) return 100;
  if (km >= zeroKm) return 0;
  return 100 * (zeroKm - km) / (zeroKm - fullScoreKm);
}

function interactionScore(event, prefs, config) {
  if (!prefs.hasSignals) return null;
  return saturate(prefs.hostPoints[event.organizationId] || 0, config);
}

function freshnessScore(event, now, config) {
  const f = config.freshness;
  const daysAway = (ms(event.startsAt) - now) / DAY;
  const soon = daysAway <= f.soonDays ? 100
    : daysAway >= f.farDays ? f.farScore
      : 100 - (100 - f.farScore) * (daysAway - f.soonDays) / (f.farDays - f.soonDays);

  let newlyListed = 0;
  if (event.createdAt) {
    const ageDays = Math.max(0, (now - ms(event.createdAt)) / DAY);
    newlyListed = ageDays <= f.newListingDays ? 100 : ageDays >= f.newListingDays * 4 ? 0
      : 100 * (f.newListingDays * 4 - ageDays) / (f.newListingDays * 3);
  }

  const left = event.slotsLeft;
  const availability = left == null ? 100 : clamp(left / f.plentyOfPlaces * 100);

  const p = f.parts;
  return (p.soon * soon + p.newlyListed * newlyListed + p.availability * availability) / (p.soon + p.newlyListed + p.availability);
}

// picked = how many events of each category are already in the list
function diversityScore(event, prefs, picked, config) {
  const interest = prefs.hasSignals ? saturate(prefs.categoryPoints[event.category] || 0, config) : 0;
  const discovery = 100 - interest; // a type they have never touched is a discovery
  const variety = 100 / (1 + (picked[event.category] || 0)); // the first of its type in the list is worth most
  const p = config.diversity.parts;
  return (p.discovery * discovery + p.variety * variety) / (p.discovery + p.variety);
}

// ---------- combining ----------

// Combines the parts that are known. Returns the 0-100 score and the weights actually used (adding up to 1).
function combine(components, weights) {
  const known = PARTS.filter((name) => components[name] != null);
  const total = known.reduce((sum, name) => sum + weights[name], 0);
  const used = {};
  let score = 0;
  for (const name of PARTS) {
    used[name] = total > 0 && components[name] != null ? weights[name] / total : 0;
    if (used[name] > 0) score += used[name] * components[name];
  }
  return { score: clamp(score), used };
}

function scoreEvent(event, prefs, picked, now, config) {
  const components = {
    interest: interestScore(event, prefs, config),
    proximity: proximityScore(event, config),
    interactions: interactionScore(event, prefs, config),
    freshness: freshnessScore(event, now, config),
    diversity: diversityScore(event, prefs, picked, config)
  };
  const { score, used } = combine(components, config.weights);
  return { score, components, used };
}

// ---------- availability ----------

// can this event still be booked? (the queries already filter, this keeps the scorer safe on its own)
function isAvailable(event, now) {
  if (event.status && event.status !== 'published') return false;
  if (event.startsAt == null || !(ms(event.startsAt) > now)) return false; // already started or over
  if (event.registrationDeadline && !(ms(event.registrationDeadline) > now)) return false;
  if (event.slotsLeft === 0) return false;
  return true;
}

// ---------- explaining ----------

// The reasons for a score, strongest first. Each is { code, params }; reasonText turns it into a sentence.
function explain(event, prefs, result, now, config) {
  const { components, used } = result;
  const worth = (part) => (components[part] == null ? 0 : used[part] * components[part]); // what the part added
  const found = [];

  if (components.interest > 0) {
    const category = event.category;
    if (prefs.attended[category]) found.push({ order: worth('interest'), code: 'attended_category', params: { category, count: prefs.attended[category] } });
    else if (prefs.chosen.has(category)) found.push({ order: worth('interest'), code: 'chose_interest', params: { category } });
    else if (prefs.booked[category]) found.push({ order: worth('interest'), code: 'booked_category', params: { category } });
  }
  if (components.proximity != null && components.proximity >= config.nearReasonMinScore) {
    const km = Math.round(event.distanceKm * 10) / 10;
    found.push({ order: worth('proximity'), code: event.distanceApproximate ? 'near_area' : 'near', params: { km } });
  }
  if (components.interactions > 0) {
    const host = event.Organization && event.Organization.name;
    if (host) found.push({ order: worth('interactions'), code: 'known_host', params: { host } });
  }

  const f = config.freshness;
  const daysAway = Math.max(0, Math.ceil((ms(event.startsAt) - now) / DAY));
  const freshness = worth('freshness');
  if (event.slotsLeft != null && event.slotsLeft <= f.plentyOfPlaces) found.push({ order: freshness + 0.001, code: 'few_places', params: { count: event.slotsLeft } });
  if (daysAway <= f.soonDays) found.push({ order: freshness, code: 'soon', params: { days: daysAway } });
  if (event.createdAt && (now - ms(event.createdAt)) / DAY <= f.newListingDays) found.push({ order: freshness - 0.001, code: 'new_listing', params: {} });

  if (prefs.hasSignals && components.interest != null && components.interest < 20) {
    found.push({ order: worth('diversity'), code: 'discover', params: { category: event.category } });
  }

  found.sort((a, b) => b.order - a.order);
  const reasons = found.slice(0, config.maxReasons).map(({ code, params }) => ({ code, params }));
  return reasons.length > 0 ? reasons : [{ code: 'upcoming', params: {} }];
}

// A reason as a sentence. `translate` is the page's t(key, vars); categories are translated too.
function reasonText(reason, translate) {
  const params = { ...reason.params };
  if (params.category) params.category = translate('category.' + params.category);
  return translate('recommend.reason.' + reason.code, params);
}

// ---------- the whole thing ----------

// events: candidates, each { id, category, organizationId, startsAt, createdAt, slotsLeft, distanceKm,
//         distanceApproximate, status, registrationDeadline, Organization: { name } }
// options: { now, limit, config (overrides for config/recommendation.js) }
// The order does not depend on `limit`: asking for 12 gives the same first 6 as asking for 6.
// Returns up to `limit` of { event, score (0-100, one decimal), components, weights, reasons }, best first.
function scoreEvents(events, profile, options = {}) {
  const config = resolveConfig(options.config);
  const now = ms(options.now || new Date());
  const limit = options.limit == null ? config.limit : options.limit;
  const prefs = analyseProfile(profile, { config, now });

  // a fixed starting order, so equal scores always come out the same way
  let remaining = events
    .filter((e) => isAvailable(e, now))
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt) || a.id - b.id);

  const window = Math.max(1, config.diversity.window);
  const maxInWindow = Math.max(1, Math.floor(window * config.diversity.maxShareOfCategory));
  const picked = {};
  const out = [];

  while (out.length < limit && remaining.length > 0) {
    // a category that already fills its share of the last few places waits behind the others,
    // but fills the list if nothing else is left
    const recent = out.slice(-(window - 1)).map((r) => r.event.category);
    const open = remaining.filter((e) => recent.filter((c) => c === e.category).length + 1 <= maxInWindow);
    const pool = open.length > 0 ? open : remaining;

    let best = null;
    for (const event of pool) {
      const result = scoreEvent(event, prefs, picked, now, config);
      if (!best || result.score > best.result.score) best = { event, result }; // ties keep the earlier (soonest) event
    }

    picked[best.event.category] = (picked[best.event.category] || 0) + 1;
    remaining = remaining.filter((e) => e !== best.event);
    out.push({
      event: best.event,
      score: round1(best.result.score),
      components: Object.fromEntries(PARTS.map((name) => [name, best.result.components[name] == null ? null : round1(best.result.components[name])])),
      weights: best.result.used,
      reasons: explain(best.event, prefs, best.result, now, config)
    });
  }
  return out;
}

module.exports = {
  PARTS, scoreEvents, analyseProfile, reasonText, isAvailable,
  // the parts on their own, for tests
  interestScore, proximityScore, interactionScore, freshnessScore, diversityScore, combine, saturate
};
