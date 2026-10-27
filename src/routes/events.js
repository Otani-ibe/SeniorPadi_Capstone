const express = require('express');
const { Op } = require('sequelize');
const { Event, Organization, Registration, EventInterest } = require('../models');
const capacity = require('../services/capacity');
const { registerAndNotify } = require('../services/registration');
const { translateEvents } = require('../services/translate');
const { needsContactCheck } = require('./verify');
const { requireAuth } = require('../middleware/auth');
const { qrSvg } = require('../services/qr');

const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('id', numericId);

// seats taken for a list of events, in one query
// returns { [eventId]: { attendee: 3, volunteer: 1 } }
async function seatCounts(eventIds) {
  const counts = {};
  if (eventIds.length === 0) return counts;

  const rows = await Registration.findAll({
    attributes: ['eventId', 'type', [Registration.sequelize.fn('COUNT', '*'), 'total']],
    where: { eventId: eventIds, status: capacity.SEAT_STATUSES },
    group: ['eventId', 'type'],
    raw: true
  });

  for (const row of rows) {
    counts[row.eventId] = counts[row.eventId] || { attendee: 0, volunteer: 0 };
    counts[row.eventId][row.type] = Number(row.total);
  }
  return counts;
}

// ---------- Find events: a deck of cards, one on top ----------
// Events they haven't skipped are in the deck. Once they've skipped everything,
// they're told so and can choose to look at the skipped ones (?skipped=1).
// Skips are remembered in the session, so this works without an account.

// the filters from a query string or form, checked against the allowed values.
// Everyone sees all of Ibadan unless they pick an area themselves.
function readFilters(source) {
  const area = Event.AREAS.includes(source.area) ? source.area : '';
  return {
    category: Event.CATEGORIES.includes(source.category) ? source.category : '',
    area,
    q: String(source.q || '').trim().slice(0, 80) // what they typed in the search box
  };
}

// links keep the filters
function eventsUrl(filters) {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  params.set('area', filters.area || 'all');
  if (filters.q) params.set('q', filters.q);
  return '/events?' + params.toString();
}

// the slots left for some events, so the numbers on the page can refresh without a reload
router.get('/events/slots.json', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => /^\d+$/.test(id)).slice(0, 60).map(Number);
  const events = ids.length ? await Event.findAll({ where: { id: ids }, attributes: ['id', 'capacity'] }) : [];
  const counts = await seatCounts(events.map((e) => e.id));
  const slots = {};
  for (const e of events) {
    const taken = counts[e.id] ? counts[e.id].attendee : 0;
    slots[e.id] = e.capacity == null ? null : Math.max(0, e.capacity - taken);
  }
  res.set('Cache-Control', 'no-store');
  res.json(slots);
});

router.get('/events', async (req, res) => {
  const now = new Date();
  const filters = readFilters(req.query);
  const where = {
    status: 'published',
    startsAt: { [Op.gt]: now },
    registrationDeadline: { [Op.gt]: now }
  };
  if (filters.category) where.category = filters.category;
  if (filters.area) where.area = filters.area;
  if (filters.q) {
    const like = { [Op.iLike]: '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%' };
    where[Op.or] = [{ title: like }, { description: like }, { locationText: like }, { '$Organization.name$': like }];
  }

  const events = await Event.findAll({ where, include: [Organization], order: [['startsAt', 'ASC']] });
  const counts = await seatCounts(events.map((e) => e.id));

  // events this senior already has a place at
  let mine = [];
  if (req.user) {
    const regs = await Registration.findAll({
      where: { seniorId: req.user.id, status: 'registered', type: 'attendee', eventId: events.map((e) => e.id) },
      attributes: ['eventId']
    });
    mine = regs.map((r) => r.eventId);
  }

  // full events and ones they're already going to aren't shown
  const open = events.filter((e) => {
    const taken = counts[e.id] ? counts[e.id].attendee : 0;
    return (e.capacity == null || taken < e.capacity) && !mine.includes(e.id);
  });
  // "slots left" for each card (empty when the event has no limit)
  for (const e of open) {
    const taken = counts[e.id] ? counts[e.id].attendee : 0;
    e.slotsLeft = e.capacity == null ? null : Math.max(0, e.capacity - taken);
  }

  // not-yet-seen events (soonest first), or, if they asked, the skipped ones in the order they were skipped
  const skipped = req.session.skippedEvents || [];
  const fresh = open.filter((e) => !skipped.includes(e.id));
  const later = skipped.map((id) => open.find((e) => e.id === id)).filter(Boolean);
  const showSkipped = req.query.skipped === '1';
  if (showSkipped && later.length === 0) return res.redirect(eventsUrl(filters));
  let deck = showSkipped ? later : fresh;

  // a guest tapped Register: that event goes on top and the sign-up pop-up opens
  const loginFor = !req.user && /^\d+$/.test(req.query.login || '') ? Number(req.query.login) : null;
  const loginEvent = deck.find((e) => e.id === loginFor);
  if (loginEvent) deck = [loginEvent].concat(deck.filter((e) => e !== loginEvent));

  // event text in Yorùbá through Google Translate (if it's set up)
  await translateEvents(deck, req.lang);

  res.render('events/index', {
    title: req.t('stack.title'),
    wide: true,
    deck,
    showSkipped,
    skippedCount: later.length,
    loginFor: loginEvent ? loginEvent.id : null,
    modalMode: req.query.mode === 'login' ? 'login' : 'signup',
    ...filters,
    categories: Event.CATEGORIES,
    areas: Event.AREAS,
    eventsUrl
  });
});

// without JavaScript the Skip button posts here and the page reloads.
// With JavaScript the card is skipped on the page and this only remembers it.
router.post('/events/:id/skip', (req, res) => {
  const id = Number(req.params.id);
  // move it to the back of the skipped list
  const skipped = (req.session.skippedEvents || []).filter((s) => s !== id);
  skipped.push(id);
  req.session.skippedEvents = skipped;

  if (req.get('Accept') === 'application/json') return res.status(204).end();
  res.redirect(eventsUrl(readFilters(req.body, req.user)) + (req.body.skipped === '1' ? '&skipped=1' : ''));
});

// ---------- one event ----------
async function loadEvent(req, res) {
  const event = await Event.findByPk(req.params.id, { include: [Organization] });
  if (!event) {
    res.status(404).render('error', { title: req.t('error.not_found_title'), message: req.t('events.not_found') });
    return null;
  }
  return event;
}

router.get('/events/:id', async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;

  const state = await capacity.getEventState(event);
  let mine = { attendee: false, volunteer: false };
  let interested = false;

  if (req.user) {
    const regs = await Registration.findAll({ where: { eventId: event.id, seniorId: req.user.id, status: 'registered' } });
    for (const r of regs) mine[r.type] = true;
    interested = Boolean(await EventInterest.findOne({
      where: { seniorId: req.user.id, category: event.category, notifiedAt: null }
    }));
  }

  await translateEvents([event], req.lang);
  res.render('events/show', { title: event.tTitle || event.title, wide: true, event, state, mine, interested });
});

// ---------- register / volunteer ----------
async function signUp(req, res, type) {
  // phone (and email) must be confirmed before joining an event
  const home = req.body.from === 'home';
  if (needsContactCheck(req, res, { registerEventId: req.params.id, type, home })) return;

  const result = await registerAndNotify(req.user, req.params.id, type);

  if (!result.ok) {
    req.flash('error', req.t(result.errorKey));
    if (home) return res.redirect('/#events');
    return res.redirect(req.body.from === 'popup' ? '/events' : '/events/' + req.params.id);
  }

  // registering from the home page: the pop-up opens over the home page, and they stay there
  if (type === 'attendee' && home) return res.redirect('/?registered=' + result.event.id + '#events');
  // registering from the card: show the "you're registered" pop-up
  if (type === 'attendee') return res.redirect('/events/' + result.event.id + '/registered');

  // "Yes, I'll volunteer" in that pop-up: back where they were
  if (home) {
    req.flash('success', req.t('registered.thanks_volunteer', { event: result.event.title }));
    return res.redirect('/#events');
  }
  if (req.body.from === 'popup') {
    req.flash('success', req.t('registered.thanks_volunteer', { event: result.event.title }));
    return res.redirect('/events');
  }
  res.redirect('/events/' + result.event.id + '/confirmed?type=' + type);
}

router.post('/events/:id/register', requireAuth, (req, res) => signUp(req, res, 'attendee'));
router.post('/events/:id/volunteer', requireAuth, (req, res) => signUp(req, res, 'volunteer'));

// the pop-up after registering: confirmation sent + volunteer or not
router.get('/events/:id/registered', requireAuth, async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;

  const place = await Registration.findOne({
    where: { eventId: event.id, seniorId: req.user.id, type: 'attendee', status: 'registered' }
  });
  if (!place) return res.redirect('/events');

  const state = await capacity.getEventState(event);
  const volunteering = await Registration.findOne({
    where: { eventId: event.id, seniorId: req.user.id, type: 'volunteer', status: 'registered' }
  });

  await translateEvents([event], req.lang);
  res.render('events/registered', {
    title: req.t('registered.title'),
    wide: true,
    event,
    ticket: place.ticketNumber,
    canVolunteer: state.volunteerEnabled && !state.volunteerFull && !volunteering
  });
});

router.get('/events/:id/confirmed', requireAuth, async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;
  const type = req.query.type === 'volunteer' ? 'volunteer' : 'attendee';
  const registration = await Registration.findOne({
    where: { eventId: event.id, seniorId: req.user.id, type, status: 'registered' }
  });
  if (!registration) return res.redirect('/events/' + event.id);

  const qr = await qrSvg(registration.qrToken);
  res.render('events/confirmed', { title: req.t('confirmed.title'), event, type, qr });
});

// ---------- "tell me when a similar event is listed" ----------
router.post('/events/:id/notify-me', requireAuth, async (req, res) => {
  const event = await loadEvent(req, res);
  if (!event) return;

  const existing = await EventInterest.findOne({ where: { seniorId: req.user.id, category: event.category } });
  if (existing) {
    await existing.update({ notifiedAt: null, sourceEventId: event.id });
  } else {
    await EventInterest.create({ seniorId: req.user.id, category: event.category, sourceEventId: event.id });
  }

  req.flash('success', req.t('notify_me.done'));
  res.redirect('/events/' + event.id);
});

module.exports = router;
