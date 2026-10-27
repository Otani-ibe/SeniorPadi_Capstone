// "Book for my mum or dad": a son or daughter books events for a parent who already has an account.
// The parent stays in control: a code goes to the PARENT's phone and they read it out, every time.
// After that, for one day on this phone, Register books the parent (not the child) and the ticket
// is texted to the parent. The child never sees the parent's messages or account pages.
const express = require('express');
const { User, Event } = require('../models');
const { normalizePhone, phoneProblem } = require('../services/phone');
const { sendCode, checkCode, CODE_MINUTES } = require('../services/verification');
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

// books the parent (their ticket is texted to THEIR phone), then shows the "registered" pop-up
// on the page the child was on
async function book(req, res, parent, eventId, back) {
  const result = await registerAndNotify(parent, eventId, 'attendee');
  if (!result.ok) {
    req.flash('error', req.t(result.errorKey));
    return res.redirect(back || '/events');
  }
  await audit(null, 'registration.booked_by_child', 'Registration', result.registration.id, { childName: req.session.bookingFor.childName });
  req.session.bookedPopup = result.registration.id; // shown once, by views/partials/bookedPopup.ejs
  res.redirect(back || '/events');
}

router.get('/book-for-parent', async (req, res) => {
  const event = await chosenEvent(req.query.event);
  const phone = /^0\d{10}$/.test(req.query.phone || '') ? req.query.phone : '';
  res.render('book/form', { title: req.t('book.title'), event, errors: {}, values: { parentPhone: phone } });
});

router.post('/book-for-parent', loginLimiter, async (req, res) => {
  const event = await chosenEvent(req.body.event);
  const values = { childName: (req.body.childName || '').trim(), parentPhone: (req.body.parentPhone || '').trim() };
  const errors = {};
  const phone = normalizePhone(values.parentPhone);

  if (values.childName.length < 2) errors.childName = req.t('signup.error_name');
  if (!phone) errors.parentPhone = req.t('phone.' + (phoneProblem(values.parentPhone) || 'start'));
  const parent = phone ? await User.findOne({ where: { phone, role: 'senior' } }) : null;
  if (phone && !parent) errors.parentPhone = req.t('book.error_none');

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('book/form', { title: req.t('book.title'), event, errors, values, noAccount: Boolean(phone && !parent) });
  }

  req.session.pendingBooking = { parentId: parent.id, childName: values.childName, eventId: event ? event.id : null, at: Date.now() };
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
  res.render('book/code', { title: req.t('book.code_title'), name: current.parent.firstName(), phone: current.parent.localPhone(), minutes: CODE_MINUTES });
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
  req.session.bookingFor = { parentId: parent.id, name: parent.firstName(), childName: p.childName, at: Date.now() };

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

// Finish: this phone stops booking for the parent
router.post('/book-for-parent/finish', (req, res) => {
  delete req.session.bookingFor;
  req.flash('success', req.t('book.finished'));
  res.redirect('/');
});

module.exports = router;
module.exports.parentOf = parentOf;
module.exports.fresh = fresh;
