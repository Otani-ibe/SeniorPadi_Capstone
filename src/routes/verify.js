// Confirming a phone number (and email, if they gave one) with a 6-digit code.
// Needed before joining an event or messaging another senior.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { sendCode, checkCode, CODE_MINUTES } = require('../services/verification');
const { registerAndNotify, safeNext } = require('../services/registration');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const codeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => res.status(429).render('error', { title: req.t('error.title'), message: req.t('error.too_many') })
});

// what to do once everything is confirmed
async function carryOn(req, res) {
  const after = req.session.afterVerify;
  delete req.session.afterVerify;

  if (after && after.registerEventId) {
    const result = await registerAndNotify(req.user, after.registerEventId, after.type || 'attendee');
    if (!result.ok) {
      req.flash('error', req.t(result.errorKey));
      return res.redirect('/events');
    }
    return res.redirect('/events/' + result.event.id + '/registered');
  }
  req.flash('success', req.t('verify.all_done'));
  res.redirect((after && after.next) || '/');
}

router.get('/verify', requireAuth, async (req, res) => {
  const next = safeNext(req.query.next);
  if (next) req.session.afterVerify = Object.assign({}, req.session.afterVerify, { next });

  if (req.user.contactVerified()) return carryOn(req, res);

  res.render('auth/verify', {
    title: req.t('verify.title'),
    sent: req.query.sent || '',
    minutes: CODE_MINUTES,
    needsEmail: Boolean(req.user.email) && !req.user.emailVerifiedAt
  });
});

router.post('/verify/send', requireAuth, codeLimiter, async (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const result = await sendCode(req.user, channel);
  if (!result.ok && result.reason === 'wait') req.flash('info', req.t('verify.wait'));
  res.redirect('/verify?sent=' + channel);
});

router.post('/verify/check', requireAuth, codeLimiter, async (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const result = await checkCode(req.user, channel, req.body.code);

  if (!result.ok) {
    req.flash('error', req.t('verify.error_' + result.reason));
    return res.redirect('/verify?sent=' + channel);
  }
  await req.user.reload();
  if (req.user.contactVerified()) return carryOn(req, res);

  req.flash('success', req.t('verify.phone_done'));
  res.redirect('/verify');
});

// used by other routes: send them to /verify first if needed
function needsContactCheck(req, res, after) {
  if (req.user.contactVerified()) return false;
  req.session.afterVerify = after;
  res.redirect('/verify');
  return true;
}

module.exports = router;
module.exports.needsContactCheck = needsContactCheck;
