const express = require('express');
const { Op } = require('sequelize');
const { Event, Organization, Registration, EventInterest } = require('../models');
const capacity = require('../services/capacity');
const { notify } = require('../services/notify');
const { shortDate, formatTime, DAY_MS } = require('../services/dates');
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

// ---------- list ----------
router.get('/events', async (req, res) => {
  const tab = req.query.tab === 'upcoming' ? 'upcoming' : 'week';
  const category = Event.CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * DAY_MS);

  const where = {
    status: 'published',
    startsAt: tab === 'week' ? { [Op.gt]: now, [Op.lte]: weekEnd } : { [Op.gt]: weekEnd }
  };
  if (category) where.category = category;

  const events = await Event.findAll({ where, include: [Organization], order: [['startsAt', 'ASC']] });
  const counts = await seatCounts(events.map((e) => e.id));

  // which events is this senior already signed up for?
  let myEventIds = [];
  if (req.user) {
    const mine = await Registration.findAll({
      where: { seniorId: req.user.id, status: 'registered', eventId: events.map((e) => e.id) },
      attributes: ['eventId']
    });
    myEventIds = mine.map((r) => r.eventId);
  }

  const cards = events.map((event) => {
    const c = counts[event.id] || { attendee: 0, volunteer: 0 };
    return {
      event,
      state: capacity.eventState(event, c.attendee, c.volunteer, now),
      isMine: myEventIds.includes(event.id)
    };
  });

  res.render('events/index', {
    title: req.t('events.title'),
    cards,
    tab,
    category,
    categories: Event.CATEGORIES
  });
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

  res.render('events/show', { title: event.title, event, state, mine, interested });
});

// ---------- register / volunteer ----------
async function signUp(req, res, type) {
  const result = await capacity.register(req.params.id, req.user.id, type);

  if (!result.ok) {
    const messages = {
      full: type === 'volunteer' ? 'register.volunteer_full' : 'register.full',
      closed: 'register.closed',
      already: 'register.already',
      not_found: 'events.not_found'
    };
    req.flash('error', req.t(messages[result.reason]));
    return res.redirect('/events/' + req.params.id);
  }

  const event = result.event;
  const user = req.user;
  notify(user, type === 'volunteer' ? 'event.volunteered' : 'event.registered', {
    name: user.firstName(),
    event: event.title,
    date: shortDate(event.startsAt),
    time: formatTime(event.startsAt),
    place: event.locationText,
    days: user.reminderDaysBefore
  });

  res.redirect('/events/' + event.id + '/confirmed?type=' + type);
}

router.post('/events/:id/register', requireAuth, (req, res) => signUp(req, res, 'attendee'));
router.post('/events/:id/volunteer', requireAuth, (req, res) => signUp(req, res, 'volunteer'));

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
