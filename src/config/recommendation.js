// Every number the Recommended for you scoring uses, in one place. The scoring itself (services/recommendationScoring.js) hardcodes none.
// RECOMMEND_WEIGHTS in .env overrides the five weights, e.g.
//   RECOMMEND_WEIGHTS={"interest":0.5,"proximity":0.2,"interactions":0.15,"freshness":0.1,"diversity":0.05}
// weights are shares, scaled to add up to 1 (40/30/15/10/5 = 0.4/0.3/0.15/0.1/0.05)

const DEFAULTS = {
  // how much each part of the score counts
  weights: {
    interest: 0.40, // does the event's category match what the senior chose and has joined before
    proximity: 0.30, // how close the venue is
    interactions: 0.15, // has the senior joined this host organization before
    freshness: 0.10, // soon, newly listed, and places left
    diversity: 0.05 // something new to them, and not the same type again and again in the list
  },

  // what each behaviour is worth in points: attended > booking > passive view. An event counts once, at its strongest
  signals: {
    attended: 3,
    registered: 2, // booked and still going (the nearest thing to "saved")
    noShow: 1, // booked but did not come
    cancelled: 0, // gave the place up: no sign of taste
    explicitInterest: 4, // asked to hear about this type of event
    viewed: 0.3, // per view of an event page; passive, so it counts least
    viewedCap: 1.5 // most points views can ever add to one category
  },
  // an old event counts for half as much every this many days
  halfLifeDays: 180,
  // points -> 0-100 with 100 * (1 - e^(-points / saturation)): first events matter most, never passes 100. 4 points is about 63
  saturation: 4,

  proximity: {
    fullScoreKm: 2, // this close (or closer) is a perfect 100
    zeroKm: 40 // this far (or further) scores 0; in between it falls in a straight line
  },

  freshness: {
    parts: { soon: 0.5, newlyListed: 0.2, availability: 0.3 }, // how the three bits share the freshness score
    soonDays: 7, // starting within this many days scores 100
    farDays: 60, // starting this far away scores the minimum
    farScore: 20,
    newListingDays: 14, // listed within this many days scores 100, falling to 0 at 4 times as long
    plentyOfPlaces: 5 // this many places left (or no limit) is "plenty"
  },

  diversity: {
    parts: { discovery: 0.5, variety: 0.5 }, // a type new to the senior / a type not yet in the list
    // in any run of `window` events no more than this share may be one category (of 4, at most 2) while other categories are left.
    // looks at runs, not the whole list, so the order is the same however many events are asked for (page 2 continues page 1)
    window: 4,
    maxShareOfCategory: 0.5
  },

  // how many reasons to give for each recommendation
  maxReasons: 3,
  // the "near you" reason is given when the proximity score is at least this
  nearReasonMinScore: 50,
  limit: 6
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, extra) {
  const out = { ...base };
  for (const key of Object.keys(extra || {})) {
    out[key] = isObject(base[key]) && isObject(extra[key]) ? merge(base[key], extra[key]) : extra[key];
  }
  return out;
}

// scales the weights to add up to 1, throws on a negative or non-number or all zero
function normaliseWeights(weights) {
  const names = Object.keys(DEFAULTS.weights);
  let total = 0;
  for (const name of names) {
    const value = weights[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Weight "' + name + '" must be a number from 0 up.');
    total += value;
  }
  if (total <= 0) throw new Error('At least one weight must be above zero.');
  const out = {};
  for (const name of names) out[name] = weights[name] / total;
  return out;
}

// settings to use: defaults, then RECOMMEND_WEIGHTS from .env, then `overrides` (tests and callers).
// a bad .env value is ignored (defaults kept), a bad override throws
function resolveConfig(overrides = {}) {
  let config = DEFAULTS;
  if (process.env.RECOMMEND_WEIGHTS) {
    try {
      const fromEnv = merge(DEFAULTS, { weights: JSON.parse(process.env.RECOMMEND_WEIGHTS) });
      normaliseWeights(fromEnv.weights);
      config = fromEnv;
    } catch (err) {
      if (!process.env.JEST_WORKER_ID) console.error('RECOMMEND_WEIGHTS ignored:', err.message);
    }
  }
  config = merge(config, overrides);
  return { ...config, weights: normaliseWeights(config.weights) };
}

module.exports = { DEFAULTS, resolveConfig, normaliseWeights };
