// Scores events for one senior, 0-100, with reasons. Pure functions: no db, no clock (now is passed in).
// Weights and tuning are in config/recommendation.js, the queries in recommendationData.js.
//
// parts, each 0-100: interest (category match), proximity, interactions (same host before),
// freshness (soon, new, places left), diversity (new type, not repeated in the list)
//
// a past event counts once, at its strongest state (attended > booked > no-show), for category and host.
// "tell me about this type" from an event already counted, and views of booked or attended events, add nothing.
// a part with no data (no history, no location) is dropped and the others share its weight.
const { resolveConfig } = require('../config/recommendation');

const DAY = 24 * 60 * 60 * 1000;
const PARTS = ['interest', 'proximity', 'interactions', 'freshness', 'diversity'];

const clamp = (n, low = 0, high = 100) => Math.min(high, Math.max(low, n));
const round1 = (n) => Math.round(n * 10) / 10;
const ms = (date) => (date instanceof Date ? date.getTime() : new Date(date).getTime());

// points -> 0-100, diminishing returns, capped at 100
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

// profile, built once per senior
// {
//   history:   [{ eventId, category, organizationId, startsAt, status }]
//   interests: [{ category, sourceEventId }]   "tell me about this type"
//   views:     [{ eventId, category, count }]  not recorded yet
// }
function analyseProfile(profile = {}, options = {}) {
  const config = options.config || resolveConfig();
  const now = ms(options.now || new Date());

  // strongest state per event
  const strongest = new Map();
  for (const item of profile.history || []) {
    const kept = strongest.get(item.eventId);
    if (!kept || statusPoints(item.status, config) > statusPoints(kept.status, config)) strongest.set(item.eventId, item);
  }

  const categoryPoints = {};
  const hostPoints = {};
  const attended = {}; // category -> attended
  const booked = {}; // category -> booked, not attended or cancelled
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

  // once per type, skipped when it came from an event already counted
  const chosen = new Set();
  for (const interest of profile.interests || []) {
    if (chosen.has(interest.category)) continue;
    chosen.add(interest.category);
    const alreadyCounted = interest.sourceEventId != null && strongest.has(interest.sourceEventId)
      && statusPoints(strongest.get(interest.sourceEventId).status, config) > 0;
    if (!alreadyCounted) add(categoryPoints, interest.category, config.signals.explicitInterest);
  }

  // views: lowest value, capped, ignored for events already booked
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

// ---------- the five parts, 0-100 or null when unknown ----------

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

// picked = events per category already in the list
function diversityScore(event, prefs, picked, config) {
  const interest = prefs.hasSignals ? saturate(prefs.categoryPoints[event.category] || 0, config) : 0;
  const discovery = 100 - interest; // never touched = discovery
  const variety = 100 / (1 + (picked[event.category] || 0)); // first of its type counts most
  const p = config.diversity.parts;
  return (p.discovery * discovery + p.variety * variety) / (p.discovery + p.variety);
}

// ---------- combining ----------

// combines the known parts, returns the score and the weights used (sum to 1)
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

// still bookable? the queries already filter, this keeps the scorer safe on its own
function isAvailable(event, now) {
  if (event.status && event.status !== 'published') return false;
  if (event.startsAt == null || !(ms(event.startsAt) > now)) return false; // started or over
  if (event.registrationDeadline && !(ms(event.registrationDeadline) > now)) return false;
  if (event.slotsLeft === 0) return false;
  return true;
}

// ---------- explaining ----------

// reasons, strongest first, each { code, params }. reasonText makes the sentence
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

// reason as a sentence. translate = the page's t(key, vars)
function reasonText(reason, translate) {
  const params = { ...reason.params };
  if (params.category) params.category = translate('category.' + params.category);
  return translate('recommend.reason.' + reason.code, params);
}

// ---------- the whole thing ----------

// events: { id, category, organizationId, startsAt, createdAt, slotsLeft, distanceKm,
//   distanceApproximate, status, registrationDeadline, Organization: { name } }
// options: { now, limit, config }
// order does not depend on limit
// -> up to limit of { event, score, components, weights, reasons }, best first
function scoreEvents(events, profile, options = {}) {
  const config = resolveConfig(options.config);
  const now = ms(options.now || new Date());
  const limit = options.limit == null ? config.limit : options.limit;
  const prefs = analyseProfile(profile, { config, now });

  // fixed start order so ties are stable
  let remaining = events
    .filter((e) => isAvailable(e, now))
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt) || a.id - b.id);

  const window = Math.max(1, config.diversity.window);
  const maxInWindow = Math.max(1, Math.floor(window * config.diversity.maxShareOfCategory));
  const picked = {};
  const out = [];

  while (out.length < limit && remaining.length > 0) {
    // a category already filling its share of the last few picks waits, but fills the list if nothing else is left
    const recent = out.slice(-(window - 1)).map((r) => r.event.category);
    const open = remaining.filter((e) => recent.filter((c) => c === e.category).length + 1 <= maxInWindow);
    const pool = open.length > 0 ? open : remaining;

    let best = null;
    for (const event of pool) {
      const result = scoreEvent(event, prefs, picked, now, config);
      if (!best || result.score > best.result.score) best = { event, result }; // ties keep the earlier event
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
  // parts alone, for tests
  interestScore, proximityScore, interactionScore, freshnessScore, diversityScore, combine, saturate
};
