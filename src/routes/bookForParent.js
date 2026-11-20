// Book for my mum or dad: a son or daughter books events for a parent who already has an account.
// the parent stays in control, a code goes to the PARENT's phone and they read it out every time.
// then for one day on this phone, Register books the parent and the ticket is texted to the parent.
// the child never sees the parent's messages or account pages. They can see and cancel the parent's event places
// for that same day (the parent is texted about every cancellation)
const express = require('express');
const { Op } = require('sequelize');
const { User, Event, Registration, Organization } = require('../models');
const notifier = require('../services/notify');
const { shortDate, formatTime } = require('../services/dates');
const { remembered, remember, forget } = require('../services/rememberBooking');

// a copy for the son or daughter (their number is not an account, so it is texted directly). Never stops the booking
function textChild(req, key, vars) {
  const phone = req.session.bookingFor && req.session.bookingFor.childPhone;
  if (phone) notifier.sendSms({ phone, preferredLanguage: req.lang }, key, vars).catch(console.error);
}
const { normalizePhone, phoneProblem } = require('../services/phone');
const { sendCode, checkCode, CODE_MINUTES, demoCodeFor } = require('../services/verification');
const { registerAndNotify } = require('../services/registration');
const { audit } = require('../services/audit');
const { safeNext } = require('../services/registration');
const { loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const { bookingActive } = require('../services/sessionTimes');
const CODE_WAIT_MINUTES = 30; // how long the code page stays open
const fresh = (at) => at && Date.now() - at < CODE_WAIT_MINUTES * 60 * 1000;

// the event they started from, if any (only one that can still be booked is worth showing)
async function chosenEvent(id) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const event = await Event.findByPk(id);
  return event && event.status === 'published' && new Date(event.startsAt) > new Date() ? event : null;
}

async function parentOf(session) {
  const b = session && session.bookingFor;
  if (!bookingActive(b)) return null;
  return User.findOne({ where: { id: b.parentId, role: 'senior' } });
}

// books the parent (ticket texted to THEIR phone), then shows the registered pop-up on the page the child was on
async function book(req, res, parent, eventId, back) {
  const result = await registerAndNotify(parent, eventId, 'attendee');
  if (!result.ok) {
    req.flash('error', req.t(result.errorKey));
    return res.redirect(back || '/events');
  }
  const { childName, childPhone } = req.session.bookingFor;
  await audit(null, 'registration.booked_by_child', 'Registration', result.registration.id, { childName, childPhone: childPhone || null });
  textChild(req, 'book.child_copy', {
    parent: parent.firstName(), event: result.event.title, ticket: result.registration.ticketNumber,
    date: shortDate(result.event.startsAt), time: formatTime(result.event.startsAt)
  });
  req.session.bookedPopup = result.registration.id; // shown once, by views/partials/bookedPopup.ejs
  res.redirect(back || '/events');
}

router.get('/book-for-parent', async (req, res) => {
  const event = await chosenEvent(req.query.event);
  const saved = remembered(req); // filled in from last time, on this phone only
  const phone = /^0\d{10}$/.test(req.query.phone || '') ? req.query.phone : '';
  const values = { childName: saved ? saved.childName : '', childPhone: saved ? saved.childPhone : '', parentPhone: phone || (saved ? saved.parentPhone : '') };
  res.render('book/form', { title: req.t('book.title'), event, errors: {}, values, saved });
});

// forget the details remembered on this phone
router.post('/book-for-parent/forget', (req, res) => {
  forget(res);
  res.redirect('/book-for-parent');
});

router.post('/book-for-parent', loginLimiter, async (req, res) => {
  const event = await chosenEvent(req.body.event);
  const values = {
    childName: (req.body.childName || '').trim(),
    childPhone: (req.body.childPhone || '').trim(),
    parentPhone: (req.body.parentPhone || '').trim()
  };
  const errors = {};
  const phone = normalizePhone(values.parentPhone);
  const childPhone = normalizePhone(values.childPhone);

  if (values.childName.length < 2) errors.childName = req.t('signup.error_name');
  if (!childPhone) errors.childPhone = req.t('phone.' + (phoneProblem(values.childPhone) || 'start'));
  if (!phone) errors.parentPhone = req.t('phone.' + (phoneProblem(values.parentPhone) || 'start'));
  if (phone && childPhone && phone === childPhone) errors.parentPhone = req.t('parent.error_same');
  const parent = phone && !errors.parentPhone ? await User.findOne({ where: { phone, role: 'senior' } }) : null;
  if (phone && !errors.parentPhone && !parent) errors.parentPhone = req.t('book.error_none');

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('book/form', { title: req.t('book.title'), event, errors, values, saved: remembered(req), noAccount: Boolean(phone && !parent && !errors.childPhone) });
  }

  req.session.pendingBooking = { parentId: parent.id, childName: values.childName, childPhone, eventId: event ? event.id : null, at: Date.now() };
  await sendCode(parent, 'phone', { smsKey: 'parent.book_code', vars: { child: values.childName } });
  res.redirect('/book-for-parent/code');
});

async function pendingParent(req) {
  const p = req.session.pendingBooking;
  if (!p || !fresh(p.at)) return null;
  const parent = await User.findOne({ where: { id: p.parentId, role: 'senior' } });
  return parent ? { parent, p } : null;
}

router.get('/book-for-parent/code', async (req, res) => {
  const current = await pendingParent(req);
  if (!current) return res.redirect('/book-for-parent');
  res.render('book/code', { title: req.t('book.code_title'), name: current.parent.firstName(), phone: current.parent.localPhone(), minutes: CODE_MINUTES, demoCode: demoCodeFor(current.parent) });
});

router.post('/book-for-parent/code', loginLimiter, async (req, res) => {
  const current = await pendingParent(req);
  if (!current) return res.redirect('/book-for-parent');

  const result = await checkCode(current.parent, 'phone', req.body.code);
  if (!result.ok) {
    req.flash('error', req.t('verify.error_' + result.reason));
    return res.redirect('/book-for-parent/code');
  }

  // the parent agreed: this phone can book for them for the next day
  const { parent, p } = current;
  delete req.session.pendingBooking;
  req.session.bookingFor = { parentId: parent.id, name: parent.firstName(), childName: p.childName, childPhone: p.childPhone, at: Date.now() };
  remember(res, { childName: p.childName, childPhone: p.childPhone, parentPhone: parent.phone }); // filled in next time

  if (p.eventId) return book(req, res, parent, p.eventId);
  req.flash('info', req.t('book.choose', { name: parent.firstName() }));
  res.redirect('/events');
});

router.post('/book-for-parent/code/resend', loginLimiter, async (req, res) => {
  const current = await pendingParent(req);
  if (!current) return res.redirect('/book-for-parent');
  const result = await sendCode(current.parent, 'phone', { smsKey: 'parent.book_code', vars: { child: current.p.childName } });
  if (!result.ok && result.reason === 'wait') req.flash('info', req.t('verify.wait'));
  else req.flash('success', req.t('login.code_resent'));
  res.redirect('/book-for-parent/code');
});

// a Register button while booking for a parent
router.post('/book-for-parent/:eventId/register', async (req, res) => {
  const parent = await parentOf(req.session);
  if (!parent || req.user) return res.redirect('/book-for-parent?event=' + encodeURIComponent(req.params.eventId));
  return book(req, res, parent, req.params.eventId, safeNext(req.body.back));
});

// the parent's upcoming places, while booking for them (the parent agreed by reading out the code).
// only events: never their messages, account or settings
router.get('/book-for-parent/tickets', async (req, res) => {
  const parent = await parentOf(req.session);
  if (!parent || req.user) return res.redirect('/book-for-parent');
  const registrations = await Registration.findAll({
    where: { seniorId: parent.id, status: 'registered' },
    include: [{ model: Event, where: { endsAt: { [Op.gt]: new Date() } }, include: [Organization] }],
    order: [[Event, 'startsAt', 'ASC']]
  });
  res.render('book/tickets', { title: req.t('book.tickets_title', { name: parent.firstName() }), name: parent.firstName(), registrations });
});

// cancels one of the parent's places. The parent is texted who cancelled it
router.post('/book-for-parent/registrations/:id/cancel', async (req, res) => {
  const parent = await parentOf(req.session);
  if (!parent || req.user) return res.redirect('/book-for-parent');
  const registration = /^\d+$/.test(req.params.id) ? await Registration.findOne({
    where: { id: req.params.id, seniorId: parent.id, status: 'registered' }, // only the parent's own
    include: [Event]
  }) : null;

  if (!registration || new Date(registration.Event.startsAt) <= new Date()) {
    req.flash('error', req.t('registrations.cannot_cancel'));
    return res.redirect('/book-for-parent/tickets');
  }

  await registration.update({ status: 'cancelled' });
  const { childName, childPhone } = req.session.bookingFor;
  await audit(null, 'registration.cancelled_by_child', 'Registration', registration.id, { childName, childPhone: childPhone || null });
  notifier.notify(parent, 'event.cancelled_by_child', {
    name: parent.firstName(), child: childName, event: registration.Event.title, date: shortDate(registration.Event.startsAt)
  }, ['sms']);
  textChild(req, 'book.child_cancel', { parent: parent.firstName(), event: registration.Event.title, date: shortDate(registration.Event.startsAt) });

  req.flash('success', req.t('book.cancelled', { name: parent.firstName(), event: registration.Event.title }));
  res.redirect('/book-for-parent/tickets');
});

// done, this phone stops booking for the parent
router.post('/book-for-parent/finish', (req, res) => {
  delete req.session.bookingFor;
  req.flash('success', req.t('book.finished'));
  res.redirect('/');
});

module.exports = router;
module.exports.parentOf = parentOf;
module.exports.fresh = fresh;
