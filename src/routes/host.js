// The host organization's check-in page: opened from the private link staff send them,
// with no account. It shows one event's guest list (names, tickets, last 4 phone digits only)
// and works only from the day before the event until 3 days after it.
const express = require('express');
const { Registration, Event, Organization, User } = require('../models');
const {
  attendanceList, attendanceCounts, setStatus, checkInByTicket, markRestMissed, markAttended,
  checkinWindow, checkinLinkState
} = require('../services/attendance');
const { audit } = require('../services/audit');
const { doorReply } = require('./doorReply');
const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('regId', numericId);

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const hostDoor = (event) => ({ base: '/checkin/' + event.checkinToken, host: true });

// finds the event for the link; shows a friendly page if the link is wrong, turned off, early or closed
async function eventForLink(req, res, next) {
  const token = req.params.token;
  const event = TOKEN.test(token) ? await Event.findOne({ where: { checkinToken: token }, include: [Organization] }) : null;
  res.set('Referrer-Policy', 'no-referrer'); // the address is the key: don't pass it on
  res.set('X-Robots-Tag', 'noindex');
  if (!event) return res.status(404).render('host/closed', { title: 'Check-in', reason: 'missing', event: null });

  const state = checkinLinkState(event);
  if (state !== 'open') return res.status(403).render('host/closed', { title: 'Check-in', reason: state, event, ...checkinWindow(event) });

  // remembered on this phone, so scanning a senior's QR code with the camera also works
  req.session.hostEvents = { ...(req.session.hostEvents || {}), [event.id]: token };
  req.event = event;
  next();
}

router.get('/checkin/:token', eventForLink, async (req, res) => {
  const event = req.event;
  res.render('host/checkin', {
    title: 'Check-in: ' + event.title,
    event,
    door: hostDoor(event),
    registrations: await attendanceList(event.id),
    counts: await attendanceCounts(event.id),
    hasStarted: new Date(event.startsAt) <= new Date(),
    closes: checkinWindow(event).closes
  });
});

router.post('/checkin/:token/registrations/:regId/status', eventForLink, async (req, res) => {
  const event = req.event;
  const reg = await setStatus(event.id, req.params.regId, req.body.status, 'host', null);
  if (reg) await audit(null, 'attendance.host.' + reg.status, 'Registration', reg.id, { eventId: event.id });
  doorReply(req, res, { event, reg, back: '/checkin/' + event.checkinToken, door: hostDoor(event) });
});

router.post('/checkin/:token/checkin', eventForLink, async (req, res) => {
  const event = req.event;
  const { reg, error } = await checkInByTicket(event.id, req.body.ticket, 'host', null);
  if (error) {
    req.flash('error', error);
  } else {
    await audit(null, 'attendance.host.ticket', 'Registration', reg.id, { eventId: event.id });
    req.flash('success', (reg.senior ? reg.senior.fullName : 'Guest') + ' (' + reg.ticketNumber + ') is checked in.');
  }
  res.redirect('/checkin/' + event.checkinToken);
});

router.post('/checkin/:token/rest-missed', eventForLink, async (req, res) => {
  const event = req.event;
  if (new Date(event.startsAt) <= new Date()) {
    const changed = await markRestMissed(event.id);
    await audit(null, 'attendance.host.rest_missed', 'Event', event.id, { changed });
    req.flash('success', changed + " marked as didn't come.");
  }
  res.redirect('/checkin/' + event.checkinToken);
});

// ---------- a senior's QR code, scanned by the host on the same phone ----------
// The code points at /admin/scan/...; staff are handled by the admin pages. Someone who isn't staff
// but has this event's check-in link open on this phone gets a simple check-in page instead.
async function hostScan(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  const hostEvents = req.session.hostEvents || {};
  if (!Object.keys(hostEvents).length || !/^[0-9a-f-]{36}$/i.test(req.params.qrToken)) return next();

  const registration = await Registration.findOne({
    where: { qrToken: req.params.qrToken },
    include: [Event, { model: User, as: 'senior', paranoid: false }]
  });
  const token = registration && hostEvents[registration.eventId];
  if (!token || registration.Event.checkinToken !== token || checkinLinkState(registration.Event) !== 'open') return next();

  if (req.method === 'POST' && ['registered', 'no_show'].includes(registration.status)) {
    await markAttended(registration, 'host', null);
    await audit(null, 'attendance.host.qr', 'Registration', registration.id, { eventId: registration.eventId });
    return res.redirect(req.originalUrl);
  }
  await registration.reload({ include: [Event, { model: User, as: 'senior', paranoid: false }] });
  res.set('Referrer-Policy', 'no-referrer');
  res.render('host/scan', { title: 'Check in', registration, listUrl: '/checkin/' + token });
}
router.get('/admin/scan/:qrToken', hostScan);
router.post('/admin/scan/:qrToken', hostScan);

module.exports = router;
