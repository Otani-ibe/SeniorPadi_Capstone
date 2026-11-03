const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { identityLimiter } = require('../middleware/rateLimit');
const identity = require('../services/identity');

const router = express.Router();

// NIN verification, only asked when someone tries Find Seniors (never at signup).
// the NIN goes from the form to services/identity.js (saved encrypted) and is forgotten, never put back in a page, redirect, flash or log

function seniorsOnly(req, res, next) {
  if (req.user.role === 'admin') return res.redirect('/admin');
  next();
}

// pages that mention verification must not be kept by the browser or a proxy
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

const renderForm = (req, res, status, errors = {}) => res.status(status).render('identity/form', {
  title: req.t('identity.title'), errors,
  reason: req.user.verificationStatus === 'rejected' ? req.user.verificationRejectionReason : null
});

router.get('/identity', requireAuth, seniorsOnly, noStore, (req, res) => {
  const status = req.user.verificationStatus;
  if (status === 'approved') return res.redirect('/find-seniors');
  // already sent and waiting, or not eligible: show where things stand instead of the form
  if (!identity.CAN_SUBMIT.includes(status)) return res.redirect('/identity/status');
  renderForm(req, res, 200);
});

const FORM_ERRORS = {
  bad_format: ['nin', 'identity.error_nin'],
  no_consent: ['consent', 'identity.error_consent'],
  too_many: ['form', 'identity.error_too_many'],
  unavailable: ['form', 'identity.error_unavailable']
};

router.post('/identity', requireAuth, seniorsOnly, noStore, identityLimiter, async (req, res) => {
  // phone must be confirmed first (it is, after the login code) so the answer is texted to the right person
  if (!req.user.phoneVerifiedAt) return res.redirect('/verify');

  const result = await identity.submitNin(req.user, req.body.nin, { consent: req.body.consent === 'yes' });
  if (!result.ok && FORM_ERRORS[result.reason]) {
    // the number is not put back in the form: they type it again
    const [field, key] = FORM_ERRORS[result.reason];
    return renderForm(req, res, 400, { [field]: req.t(key) });
  }
  res.redirect('/identity/status'); // sent, already sent, or not allowed now
});

// where things stand, in words that fit each state
router.get('/identity/status', requireAuth, seniorsOnly, noStore, async (req, res) => {
  const status = req.user.verificationStatus;
  const retry = identity.CAN_SUBMIT.includes(status) && (await identity.rejectionsLeft(req.user)) > 0;
  res.render('identity/status', {
    title: req.t('identity.status_title'), status, retry,
    reason: status === 'rejected' ? req.user.verificationRejectionReason : null
  });
});

module.exports = router;
