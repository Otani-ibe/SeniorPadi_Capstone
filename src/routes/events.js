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

// ---------- Find events: one card at a time ----------
// Shows events people can still join, one by one. Skip moves to the next card.
// Skipped events are remembered in the session, so this works without an account.
router.get('/events', async (req, res) => {
  const now = new Date();
  const category = Event.CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const where = {
    status: 'published',
    startsAt: { [Op.gt]: now },
    registrationDeadline: { [Op.gt]: now }
  };
  if (category) where.category = category;

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
    return taken < e.capacity && !mine.includes(e.id);
  });

  const skipped = req.session.skippedEvents || [];
  const remaining = open.filter((e) => !skipped.includes(e.id));
  const event = remaining[0] || null;
  const nextEvent = remaining[1] || null; // shown peeking behind the card

  // a guest tapped Register: show the log-in pop-up for this event
  const loginFor = !req.user && /^\d+$/.test(req.query.login || '') ? Number(req.query.login) : null;

  // event text in Yorùbá through Google Translate (if it's set up)
  if (event) await translateEvents([event], req.lang);

  res.render('events/index', {
    title: req.t('stack.title'),
    wide: true,
    event,
    position: open.length - remaining.length + 1,
    total: open.length,
    canStartAgain: open.length > 0 && remaining.length === 0,
    nextEvent,
    loginFor,
    modalMode: req.query.mode === 'login' ? 'login' : 'signup',
    category,
    categories: Event.CATEGORIES
  });
});

router.post('/events/start-again', (req, res) => {
  req.session.skippedEvents = [];
  const category = Event.CATEGORIES.includes(req.body.category) ? req.body.category : '';
  res.redirect('/events' + (category ? '?category=' + category : ''));
});

router.post('/events/:id/skip', (req, res) => {
  const skipped = req.session.skippedEvents || [];
  const id = Number(req.params.id);
  if (!skipped.includes(id)) skipped.push(id);
  req.session.skippedEvents = skipped;
  const category = Event.CATEGORIES.includes(req.body.category) ? req.body.category : '';
  res.redirect('/events' + (category ? '?category=' + category : ''));
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
  if (needsContactCheck(req, res, { registerEventId: req.params.id, type })) return;

  const result = await registerAndNotify(req.user, req.params.id, type);

  if (!result.ok) {
    req.flash('error', req.t(result.errorKey));
    return res.redirect(req.body.from === 'popup' ? '/events' : '/events/' + req.params.id);
  }

  // registering from the card: show the "you're registered" pop-up
  if (type === 'attendee') return res.redirect('/events/' + result.event.id + '/registered');

  // "Yes, I'll volunteer" in that pop-up: back to the next card
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
