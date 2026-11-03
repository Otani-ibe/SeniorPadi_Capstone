// Unit tests for the scoring: no database, fixed clock.
const { resolveConfig, DEFAULTS } = require('../src/config/recommendation');
const scoring = require('../src/services/recommendationScoring');
const { t } = require('../src/services/i18n');

const NOW = new Date('2026-11-02T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const days = (n) => new Date(NOW.getTime() + n * DAY);
const config = resolveConfig();

let nextId = 1;
// an event that can be booked, 5 days away, in no particular place
function ev(extra = {}) {
  const id = nextId++;
  return {
    id, title: 'Event ' + id, category: 'social', organizationId: 100, status: 'published',
    startsAt: days(5), registrationDeadline: days(4), createdAt: days(-30), slotsLeft: null,
    distanceKm: null, Organization: { name: 'Host ' + 100 }, ...extra
  };
}
const past = (eventId, category, status, ageDays = 10, organizationId = 100) => ({ eventId, category, organizationId, status, startsAt: days(-ageDays) });
const score = (events, profile, options = {}) => scoring.scoreEvents(events, profile, { now: NOW, ...options });
const ids = (list) => list.map((r) => r.event.id);

describe('the weights', () => {
  test('start at 40 / 30 / 15 / 10 / 5 and add up to 1', () => {
    expect(config.weights).toEqual({ interest: 0.4, proximity: 0.3, interactions: 0.15, freshness: 0.1, diversity: 0.05 });
    expect(Object.values(config.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  test('can be changed, and are scaled to add up to 1 (so 4 and 6 mean 40% and 60%)', () => {
    const c = resolveConfig({ weights: { interest: 4, proximity: 6, interactions: 0, freshness: 0, diversity: 0 } });
    expect(c.weights.interest).toBeCloseTo(0.4);
    expect(c.weights.proximity).toBeCloseTo(0.6);
    expect(resolveConfig().weights.interest).toBeCloseTo(0.4); // the defaults were not touched
    expect(DEFAULTS.weights.interest).toBe(0.4);
  });

  test('bad weights are refused instead of silently giving odd results', () => {
    expect(() => resolveConfig({ weights: { interest: -1 } })).toThrow(/Weight "interest"/);
    expect(() => resolveConfig({ weights: { interest: 'a lot' } })).toThrow();
    expect(() => resolveConfig({ weights: { interest: 0, proximity: 0, interactions: 0, freshness: 0, diversity: 0 } })).toThrow(/above zero/);
  });

  test('RECOMMEND_WEIGHTS in .env changes them, and nonsense there is ignored', () => {
    process.env.RECOMMEND_WEIGHTS = '{"interest":1,"proximity":1,"interactions":0,"freshness":0,"diversity":0}';
    try {
      expect(resolveConfig().weights.proximity).toBeCloseTo(0.5);
      process.env.RECOMMEND_WEIGHTS = 'not json';
      expect(resolveConfig().weights.interest).toBeCloseTo(0.4);
      process.env.RECOMMEND_WEIGHTS = '{"interest":-5}';
      expect(resolveConfig().weights.interest).toBeCloseTo(0.4);
    } finally {
      delete process.env.RECOMMEND_WEIGHTS;
    }
  });

  test('changing them changes the order: a near event beats a perfect-interest one when only distance counts', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended'), past(3, 'fitness', 'attended')] };
    const liked = ev({ category: 'fitness', distanceKm: 30 });
    const near = ev({ category: 'social', organizationId: 200, distanceKm: 1 });
    expect(ids(score([liked, near], profile))).toEqual([liked.id, near.id]);
    const onlyDistance = { weights: { interest: 0, proximity: 1, interactions: 0, freshness: 0, diversity: 0 } };
    expect(ids(score([liked, near], profile, { config: onlyDistance }))).toEqual([near.id, liked.id]);
  });
});

describe('each part of the score', () => {
  test('proximity falls in a straight line from 100 to 0, and is unknown without a distance', () => {
    const p = (km) => scoring.proximityScore({ distanceKm: km }, config);
    expect(p(0)).toBe(100);
    expect(p(config.proximity.fullScoreKm)).toBe(100);
    expect(p(config.proximity.zeroKm)).toBe(0);
    expect(p(500)).toBe(0);
    expect(p(21)).toBeCloseTo(50, 0);
    expect(p(5)).toBeGreaterThan(p(10));
    for (const bad of [null, undefined, NaN, -3, 'far']) expect(p(bad)).toBeNull();
  });

  test('freshness: sooner, newly listed and plenty of places score higher', () => {
    const f = (extra) => scoring.freshnessScore({ startsAt: days(5), createdAt: days(-1), slotsLeft: null, ...extra }, NOW.getTime(), config);
    expect(f({})).toBeGreaterThan(f({ startsAt: days(50) }));
    expect(f({})).toBeGreaterThan(f({ createdAt: days(-90) }));
    expect(f({})).toBeGreaterThan(f({ slotsLeft: 1 }));
    expect(f({ slotsLeft: 50 })).toBe(f({ slotsLeft: null })); // no limit and lots of places are both "plenty"
    expect(f({})).toBe(100);
    for (const extra of [{ startsAt: days(400) }, { createdAt: undefined }, { slotsLeft: 0 }]) {
      const value = f(extra);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  test('diversity: a type the senior has never touched, and the first of its type in the list, score highest', () => {
    const prefs = scoring.analyseProfile({ history: [past(1, 'fitness', 'attended')] }, { config, now: NOW });
    const d = (category, picked = {}) => scoring.diversityScore({ category }, prefs, picked, config);
    expect(d('faith')).toBeGreaterThan(d('fitness'));
    expect(d('faith')).toBeGreaterThan(d('faith', { faith: 2 }));
  });
});

describe('what a senior has done', () => {
  const analyse = (profile) => scoring.analyseProfile(profile, { config, now: NOW });

  test('attending counts for more than booking, which counts for more than a passive view', () => {
    const attended = analyse({ history: [past(1, 'fitness', 'attended', 0)] }).categoryPoints.fitness;
    const booked = analyse({ history: [past(1, 'fitness', 'registered', 0)] }).categoryPoints.fitness;
    const noShow = analyse({ history: [past(1, 'fitness', 'no_show', 0)] }).categoryPoints.fitness;
    const viewed = analyse({ views: [{ eventId: 1, category: 'fitness', count: 1 }] }).categoryPoints.fitness;
    expect(attended).toBeGreaterThan(booked);
    expect(booked).toBeGreaterThan(noShow);
    expect(noShow).toBeGreaterThan(viewed);
    expect(viewed).toBeGreaterThan(0);
  });

  test('a cancelled booking says nothing about taste', () => {
    const prefs = analyse({ history: [past(1, 'fitness', 'cancelled', 0)] });
    expect(prefs.categoryPoints.fitness).toBeUndefined();
    expect(prefs.hasSignals).toBe(false);
  });

  test('the same event is counted once, at its strongest: attended + booked rows do not add up', () => {
    const once = analyse({ history: [past(1, 'fitness', 'attended', 0)] }).categoryPoints.fitness;
    const twice = analyse({ history: [past(1, 'fitness', 'registered', 0), past(1, 'fitness', 'attended', 0)] }).categoryPoints.fitness;
    expect(twice).toBe(once);
    expect(analyse({ history: [past(1, 'fitness', 'attended', 0), past(1, 'fitness', 'attended', 0)] }).categoryPoints.fitness).toBe(once);
  });

  test('"tell me about this type" made from an event they also booked is not counted again', () => {
    const booked = analyse({ history: [past(7, 'health', 'registered', 0)] }).categoryPoints.health;
    const withInterest = analyse({
      history: [past(7, 'health', 'registered', 0)], interests: [{ category: 'health', sourceEventId: 7 }]
    });
    expect(withInterest.categoryPoints.health).toBe(booked);
    expect(withInterest.chosen.has('health')).toBe(true); // still known as chosen, for the explanation
    // from an event they did not book, it is a real choice and counts in full
    const chosenOnly = analyse({ interests: [{ category: 'health', sourceEventId: 99 }] }).categoryPoints.health;
    expect(chosenOnly).toBe(config.signals.explicitInterest);
  });

  test('views of an event they booked or attended add nothing, and views are capped', () => {
    const base = analyse({ history: [past(1, 'fitness', 'attended', 0)] }).categoryPoints.fitness;
    const withView = analyse({ history: [past(1, 'fitness', 'attended', 0)], views: [{ eventId: 1, category: 'fitness', count: 9 }] });
    expect(withView.categoryPoints.fitness).toBe(base);
    const flooded = analyse({ views: [{ eventId: 5, category: 'faith', count: 1000 }, { eventId: 6, category: 'faith', count: 1000 }] });
    expect(flooded.categoryPoints.faith).toBe(config.signals.viewedCap);
    expect(flooded.categoryPoints.faith).toBeLessThan(config.signals.registered); // views alone never outweigh one booking
  });

  test('older events count for less', () => {
    const recent = analyse({ history: [past(1, 'fitness', 'attended', 10)] }).categoryPoints.fitness;
    const old = analyse({ history: [past(1, 'fitness', 'attended', 365)] }).categoryPoints.fitness;
    expect(old).toBeLessThan(recent);
    expect(old).toBeGreaterThan(0);
    expect(analyse({ history: [past(1, 'fitness', 'attended', config.halfLifeDays)] }).categoryPoints.fitness).toBeCloseTo(config.signals.attended / 2);
  });

  test('a new senior has no signals at all', () => {
    for (const profile of [undefined, {}, { history: [], interests: [], views: [] }]) {
      expect(analyse(profile).hasSignals).toBe(false);
    }
  });
});

describe('scoring and ranking', () => {
  test('every score is between 0 and 100, with a breakdown whose weights add up to 1', () => {
    const profile = { history: [past(1, 'fitness', 'attended')], interests: [{ category: 'faith', sourceEventId: null }] };
    const events = ['fitness', 'faith', 'social', 'learning'].map((category, i) => ev({ category, distanceKm: i * 20, slotsLeft: i }));
    const results = score(events.concat(ev({ distanceKm: 0, createdAt: days(0), startsAt: days(1) })), profile, { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      for (const part of scoring.PARTS) {
        if (r.components[part] != null) {
          expect(r.components[part]).toBeGreaterThanOrEqual(0);
          expect(r.components[part]).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  test('an event with everything going for it scores very high, and one with nothing scores low', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended'), past(3, 'fitness', 'attended'), past(4, 'fitness', 'attended')] };
    const [best] = score([ev({ category: 'fitness', distanceKm: 0.5, startsAt: days(2), createdAt: days(0) })], profile);
    expect(best.score).toBeGreaterThan(85);
    const [worst] = score([ev({ category: 'charity', organizationId: 9, distanceKm: 80, startsAt: days(90), createdAt: days(-300), slotsLeft: 1 })], profile);
    expect(worst.score).toBeLessThan(25);
  });

  test('a category they attended ranks above one they only viewed, which ranks above one they never touched', () => {
    const profile = {
      history: [past(1, 'fitness', 'attended')],
      views: [{ eventId: 50, category: 'faith', count: 2 }]
    };
    const fitness = ev({ category: 'fitness', organizationId: 7 });
    const faith = ev({ category: 'faith', organizationId: 8 });
    const charity = ev({ category: 'charity', organizationId: 9 });
    expect(ids(score([charity, faith, fitness], profile, { limit: 3 }))).toEqual([fitness.id, faith.id, charity.id]);
  });

  test('a host they joined before adds to the score', () => {
    const profile = { history: [past(1, 'learning', 'attended', 10, 55)] };
    const same = ev({ category: 'social', organizationId: 55 });
    const other = ev({ category: 'social', organizationId: 56 });
    const results = score([other, same], profile);
    expect(results[0].event.id).toBe(same.id);
    expect(results[0].components.interactions).toBeGreaterThan(results[1].components.interactions);
  });

  test('a new senior with no history and no place still gets a ranked list, soonest and freshest first', () => {
    const soon = ev({ startsAt: days(2), registrationDeadline: days(1), createdAt: days(-1) });
    const later = ev({ startsAt: days(40), registrationDeadline: days(39), createdAt: days(-100) });
    const results = score([later, soon], { history: [], interests: [] });
    expect(ids(results)).toEqual([soon.id, later.id]);
    for (const r of results) {
      expect(r.components.interest).toBeNull();
      expect(r.components.interactions).toBeNull();
      expect(r.components.proximity).toBeNull();
      expect(r.weights.interest).toBe(0);
      expect(r.weights.freshness + r.weights.diversity).toBeCloseTo(1); // the known parts share the whole weight
      expect(r.score).toBeGreaterThan(0);
    }
    expect(score([soon], undefined)).toHaveLength(1); // no profile at all
  });

  test('a new senior who is near events is ranked by distance, not marked down for having no past', () => {
    const near = ev({ distanceKm: 1 });
    const far = ev({ distanceKm: 35 });
    const results = score([far, near], {});
    expect(ids(results)).toEqual([near.id, far.id]);
    expect(results[0].weights.proximity).toBeGreaterThan(0.5);
  });

  test('a senior with history but no place keeps interest and ignores distance', () => {
    const profile = { history: [past(1, 'faith', 'attended')] };
    const [r] = score([ev({ category: 'faith' })], profile);
    expect(r.components.proximity).toBeNull();
    expect(r.components.interest).toBeGreaterThan(0);
  });

  test('expired, cancelled, completed, closed, full and unpublished events are never recommended', () => {
    const good = ev();
    const bad = [
      ev({ status: 'cancelled' }), ev({ status: 'completed' }), ev({ status: 'draft' }),
      ev({ startsAt: days(-1) }), ev({ startsAt: new Date(NOW.getTime() - 1) }),
      ev({ registrationDeadline: days(-1) }), ev({ registrationDeadline: new Date(NOW.getTime()) }),
      ev({ slotsLeft: 0 }), ev({ startsAt: undefined }), ev({ startsAt: 'not a date' })
    ];
    expect(ids(score(bad.concat(good), {}, { limit: 20 }))).toEqual([good.id]);
  });

  test('one category does not fill the list: at most half of it while other types are available', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended'), past(3, 'fitness', 'attended')], interests: [{ category: 'fitness' }] };
    const fitness = [1, 2, 3, 4, 5].map((i) => ev({ category: 'fitness', distanceKm: i }));
    const others = [ev({ category: 'social', distanceKm: 30 }), ev({ category: 'faith', distanceKm: 30 }), ev({ category: 'learning', distanceKm: 30 })];
    const picks = score(fitness.concat(others), profile, { limit: 4 });
    const inList = picks.map((r) => r.event.category);
    expect(inList).toHaveLength(4);
    expect(inList.filter((c) => c === 'fitness')).toHaveLength(2);
    expect(inList[0]).toBe('fitness'); // the favourite is still first
    expect(new Set(inList).size).toBeGreaterThanOrEqual(3);
  });

  test('asking for more continues the same list: page 2 never reshuffles page 1', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended')] };
    const cats = ['fitness', 'fitness', 'fitness', 'faith', 'social', 'fitness', 'learning', 'fitness', 'health', 'fitness'];
    const events = cats.map((category, i) => ev({ category, distanceKm: 3 + i, startsAt: days(2 + i), registrationDeadline: days(1) }));
    const six = ids(score(events, profile, { limit: 6 }));
    const ten = ids(score(events, profile, { limit: 10 }));
    expect(ten.slice(0, 6)).toEqual(six);
    expect(new Set(ten).size).toBe(10); // nobody twice
    // in every run of 4, at most 2 are the same category
    const runs = score(events, profile, { limit: 10 }).map((r) => r.event.category);
    for (let i = 0; i + 4 <= runs.length; i++) {
      expect(runs.slice(i, i + 4).filter((c) => c === 'fitness').length).toBeLessThanOrEqual(2);
    }
  });

  test('when only one category exists, it still fills the list', () => {
    const picks = score([1, 2, 3, 4].map(() => ev({ category: 'fitness' })), {}, { limit: 4 });
    expect(picks).toHaveLength(4);
  });

  test('the same input always gives the same answer, whatever order the events arrive in', () => {
    const profile = { history: [past(1, 'fitness', 'attended')] };
    const events = [1, 2, 3, 4, 5, 6].map((i) => ev({ category: ['fitness', 'faith', 'social'][i % 3], distanceKm: (i * 7) % 40, startsAt: days(1 + (i % 3)), registrationDeadline: days(0.5) }));
    const first = ids(score(events, profile, { limit: 6 }));
    expect(ids(score(events.slice().reverse(), profile, { limit: 6 }))).toEqual(first);
    expect(ids(score(events, profile, { limit: 6 }))).toEqual(first);
    // exact ties go to the lowest id, however they arrive
    const x = ev({ startsAt: days(3) });
    const y = ev({ startsAt: days(3) });
    expect(ids(score([y, x], {}))).toEqual([x.id, y.id]);
  });

  test('limit is respected, and zero events is an empty list', () => {
    expect(score([ev(), ev(), ev()], {}, { limit: 2 })).toHaveLength(2);
    expect(score([], {})).toEqual([]);
  });
});

describe('the reasons', () => {
  const codes = (r) => r.reasons.map((x) => x.code);

  test('attending is explained with how many times', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended')] };
    const [r] = score([ev({ category: 'fitness' })], profile);
    expect(r.reasons[0]).toEqual({ code: 'attended_category', params: { category: 'fitness', count: 2 } });
  });

  test('a chosen interest, a booking, a nearby venue and a known host each get their own reason', () => {
    const chosen = score([ev({ category: 'health' })], { interests: [{ category: 'health', sourceEventId: null }] })[0];
    expect(codes(chosen)).toContain('chose_interest');
    const booked = score([ev({ category: 'faith' })], { history: [past(1, 'faith', 'registered')] })[0];
    expect(codes(booked)).toContain('booked_category');
    const near = score([ev({ distanceKm: 1.234 })], {})[0];
    expect(near.reasons.find((x) => x.code === 'near').params.km).toBe(1.2);
    const approx = score([ev({ distanceKm: 2, distanceApproximate: true })], {})[0];
    expect(codes(approx)).toContain('near_area');
    const host = score([ev({ organizationId: 7, Organization: { name: 'Adeoye Trust' } })], { history: [past(1, 'learning', 'attended', 10, 7)] })[0];
    expect(host.reasons.find((x) => x.code === 'known_host').params.host).toBe('Adeoye Trust');
  });

  test('timing and places left are explained, and a far-off event with nothing special still says something', () => {
    const urgent = score([ev({ startsAt: days(2), slotsLeft: 2 })], {})[0];
    expect(codes(urgent)).toEqual(expect.arrayContaining(['soon', 'few_places']));
    const plain = score([ev({ startsAt: days(50), registrationDeadline: days(49), createdAt: days(-300), slotsLeft: null })], {})[0];
    expect(plain.reasons.length).toBeGreaterThanOrEqual(1);
    expect(codes(plain)).toEqual(['upcoming']);
  });

  test('a type they have not tried is presented as a discovery, and at most three reasons are given', () => {
    const profile = { history: [past(1, 'fitness', 'attended'), past(2, 'fitness', 'attended')] };
    const [r] = score([ev({ category: 'creativity', organizationId: 999, startsAt: days(30), registrationDeadline: days(29), createdAt: days(-200) })], profile);
    expect(codes(r)).toEqual(['discover']);
    // with plenty of other reasons it is not shown: at most three, strongest first
    const [busy] = score([ev({ category: 'creativity', distanceKm: 1, startsAt: days(1), slotsLeft: 1, createdAt: days(0) })], profile);
    expect(busy.reasons.length).toBeLessThanOrEqual(3);
    const tight = score([ev({ distanceKm: 1, startsAt: days(1), slotsLeft: 1, createdAt: days(0) })], {}, { config: { maxReasons: 1 } })[0];
    expect(tight.reasons).toHaveLength(1);
  });

  test('reasonText gives a readable sentence in English and Yorùbá, with the category translated', () => {
    const en = (key, vars) => t(key, 'en', vars);
    const yo = (key, vars) => t(key, 'yo', vars);
    const reason = { code: 'attended_category', params: { category: 'fitness', count: 2 } };
    expect(scoring.reasonText(reason, en)).toBe('You have been to 2 Fitness event(s) before');
    expect(scoring.reasonText(reason, yo)).not.toBe(scoring.reasonText(reason, en));
    expect(scoring.reasonText({ code: 'near', params: { km: 1.2 } }, en)).toBe('Only 1.2 km from you');
    for (const code of ['attended_category', 'chose_interest', 'booked_category', 'near', 'near_area', 'known_host', 'soon', 'few_places', 'new_listing', 'discover', 'upcoming']) {
      expect(scoring.reasonText({ code, params: { category: 'faith', count: 1, km: 1, host: 'X', days: 1 } }, en)).not.toContain('recommend.reason');
      expect(scoring.reasonText({ code, params: { category: 'faith', count: 1, km: 1, host: 'X', days: 1 } }, yo)).not.toContain('recommend.reason');
    }
  });
});
