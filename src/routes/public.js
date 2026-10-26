const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { User, Event, Registration } = require('../models');
const capacity = require('../services/capacity');
const { sendCode, checkCode, CODE_MINUTES } = require('../services/verification');
const { recommendedEvents } = require('../services/recommend');
const { translateEvents } = require('../services/translate');
const { normalizePhone, phoneProblem } = require('../services/phone');
const { registerAndNotify, safeNext } = require('../services/registration');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;
const MIN_PASSWORD = 6;

function logIn(req, user) {
  req.session.userId = user.id;
  delete req.session.lang;
}

// for Render and uptime checkers: is the app up and can it reach the database?
router.get('/health', async (req, res) => {
  try {
    await User.sequelize.authenticate();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

router.get('/', async (req, res) => {
  if (req.user && req.user.role === 'admin') return res.redirect('/admin');

  // recommended events: like the ones a signed-in senior joined before, or random for a visitor
  const recommended = await recommendedEvents(req.user, 4);
  await translateEvents(recommended, req.lang);

  // they just registered from this page: show their ticket on top of it
  let justRegistered = null;
  if (req.user && /^\d+$/.test(req.query.registered || '')) {
    const place = await Registration.findOne({
      where: { eventId: req.query.registered, seniorId: req.user.id, type: 'attendee', status: 'registered' },
      include: [Event]
    });
    if (place && place.Event) {
      const state = await capacity.getEventState(place.Event);
      const volunteering = await Registration.findOne({
        where: { eventId: place.eventId, seniorId: req.user.id, type: 'volunteer', status: 'registered' }
      });
      await translateEvents([place.Event], req.lang);
      justRegistered = {
        event: place.Event,
        ticket: place.ticketNumber,
        canVolunteer: state.volunteerEnabled && !state.volunteerFull && !volunteering
      };
    }
  }

  res.render('home', { title: 'SeniorPadi', fullWidth: true, recommended, justRegistered });
});

router.get('/about', (req, res) => {
  res.render('about', { title: req.t('about.title'), wide: true });
});

// Call SeniorPadi: account help, questions, listing an event
router.get('/call', (req, res) => {
  res.render('call', {
    title: req.t('call.title'),
    hours: process.env.SUPPORT_HOURS || req.t('call.hours_default')
  });
});

// switch language (works logged in or out)
router.post('/language', async (req, res) => {
  const lang = req.body.lang === 'yo' ? 'yo' : 'en';
  if (req.user) await req.user.update({ preferredLanguage: lang });
  else req.session.lang = lang;

  const back = req.body.back && req.body.back.startsWith('/') ? req.body.back : '/';
  res.redirect(back);
});

// ---------- sign up and log in ----------
// Seniors have no password: they type their phone number, we text a 6-digit code, and typing it in
// signs them in. A new number is a new account. Staff accounts still use a password.

// what to do after logging in or signing up (from the pop-ups)
function afterAuth(source) {
  return {
    registerEventId: /^\d+$/.test(source.register || source.registerEventId || '') ? String(source.register || source.registerEventId) : '',
    next: safeNext(source.next) || '',
    home: source.from === 'home' || source.home === true // started on the home page: come back to it
  };
}

// log them in, then register them if they came from an event's Register button
async function finishAuth(req, res, user, after, fallback) {
  if (after.registerEventId && !user.contactVerified()) {
    // confirm their phone (and email) first, then register them
    req.session.afterVerify = { registerEventId: after.registerEventId, type: 'attendee', home: after.home };
    return res.redirect('/verify');
  }
  if (after.registerEventId) {
    const result = await registerAndNotify(user, after.registerEventId, 'attendee');
    if (result.ok) return res.redirect(after.home ? '/?registered=' + result.event.id + '#events' : '/events/' + result.event.id + '/registered');
    req.flash('error', req.t(result.errorKey));
    return res.redirect(after.home ? '/#events' : '/events');
  }
  if (after.next) return res.redirect(after.next);
  return res.redirect(fallback);
}

// who is in the middle of signing in (typed their number, not their code yet). Lasts 30 minutes.
const PENDING_MINUTES = 30;
async function pendingSignIn(req) {
  const pending = req.session.pendingLogin;
  if (!pending || Date.now() - pending.at > PENDING_MINUTES * 60 * 1000) return null;
  const user = await User.findByPk(pending.userId);
  return user ? { user, pending } : null;
}

// text the code and show the code page (staff are asked for their password instead)
async function startSignIn(req, res, user, after, isNew) {
  req.session.pendingLogin = { userId: user.id, after, isNew: Boolean(isNew), at: Date.now() };
  if (user.role === 'admin') return res.redirect('/login/password');
  await sendCode(user, 'phone');
  return res.redirect('/login/code');
}

// everything that happens once someone is really signed in
async function completeSignIn(req, res, user, pending) {
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  delete req.session.pendingLogin;
  logIn(req, user);

  if (user.role === 'admin') {
    return res.redirect(returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin');
  }
  if (pending.isNew) req.flash('success', req.t('signup.welcome', { name: user.firstName() }));
  const after = pending.after || {};
  if (after.registerEventId || after.next) return finishAuth(req, res, user, after, '/');
  if (!user.onboardingSeenAt) return res.redirect('/onboarding');
  res.redirect(returnTo || '/');
}

router.get('/signup', (req, res) => {
  res.render('auth/signup', { title: req.t('signup.title'), errors: {}, values: {}, after: afterAuth(req.query) });
});

router.post('/signup', signupLimiter, async (req, res) => {
  const values = {
    fullName: (req.body.fullName || '').trim(),
    phone: (req.body.phone || '').trim(),
    ageDeclared: req.body.ageDeclared === 'yes'
  };
  const errors = {};

  const phone = normalizePhone(values.phone);
  if (values.fullName.length < 2) errors.fullName = req.t('signup.error_name');
  if (!phone) errors.phone = req.t('phone.' + (phoneProblem(values.phone) || 'start'));
  if (!values.ageDeclared) errors.ageDeclared = req.t('signup.error_age');

  // a number that started signing up but never typed its code can be used again
  const existing = phone ? await User.findOne({ where: { phone }, paranoid: false }) : null;
  const reusable = existing && !existing.deletedAt && existing.role === 'senior' && !existing.phoneVerifiedAt;
  if (existing && !reusable && !errors.phone) errors.phone = req.t('signup.error_phone_taken');

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('auth/signup', { title: req.t('signup.title'), errors, values, after: afterAuth(req.body) });
  }

  // no password to choose: the column is filled with a random one nobody knows
  const user = reusable
    ? await existing.update({ fullName: values.fullName, preferredLanguage: req.lang })
    : await User.create({
      fullName: values.fullName,
      phone,
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), BCRYPT_COST),
      ageDeclared: true,
      preferredLanguage: req.lang
    });

  return startSignIn(req, res, user, afterAuth(req.body), true);
});

// ---------- log in / out ----------
router.get('/login', (req, res) => {
  const phone = /^0\d{10}$/.test(req.query.phone || '') ? req.query.phone : '';
  res.render('auth/login', { title: req.t('login.title'), error: null, phone, after: afterAuth(req.query) });
});

router.post('/login', loginLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const fail = (message) => res.status(400).render('auth/login', {
    title: req.t('login.title'), error: message, phone: req.body.phone || '', after: afterAuth(req.body)
  });

  // tell them clearly if the number itself is wrong
  if (!phone) return fail(req.t('phone.' + (phoneProblem(req.body.phone) || 'start')));

  const user = await User.findOne({ where: { phone } });
  if (!user) return fail(req.t('forgot.not_found'));

  return startSignIn(req, res, user, afterAuth(req.body), false);
});

// the code page: type the 6 digits we texted, or ask for them again
router.get('/login/code', async (req, res) => {
  const current = await pendingSignIn(req);
  if (!current || current.user.role === 'admin') return res.redirect('/login');
  res.render('auth/code', { title: req.t('login.code_title'), phone: current.user.localPhone(), minutes: CODE_MINUTES });
});

router.post('/login/code', loginLimiter, async (req, res) => {
  const current = await pendingSignIn(req);
  if (!current || current.user.role === 'admin') return res.redirect('/login');

  const result = await checkCode(current.user, 'phone', req.body.code);
  if (!result.ok) {
    req.flash('error', req.t('verify.error_' + result.reason));
    return res.redirect('/login/code');
  }
  await current.user.reload();
  return completeSignIn(req, res, current.user, current.pending);
});

router.post('/login/code/resend', loginLimiter, async (req, res) => {
  const current = await pendingSignIn(req);
  if (!current || current.user.role === 'admin') return res.redirect('/login');

  const result = await sendCode(current.user, 'phone');
  if (!result.ok && result.reason === 'wait') req.flash('info', req.t('verify.wait'));
  else req.flash('success', req.t('login.code_resent'));
  res.redirect('/login/code');
});

// staff (admin) accounts: phone number, then password
router.get('/login/password', async (req, res) => {
  const current = await pendingSignIn(req);
  if (!current || current.user.role !== 'admin') return res.redirect('/login');
  res.render('auth/password', { title: req.t('login.staff_title'), phone: current.user.localPhone(), error: null });
});

router.post('/login/password', loginLimiter, async (req, res) => {
  const current = await pendingSignIn(req);
  if (!current || current.user.role !== 'admin') return res.redirect('/login');

  if (!(await bcrypt.compare(req.body.password || '', current.user.passwordHash))) {
    return res.status(400).render('auth/password', {
      title: req.t('login.staff_title'), phone: current.user.localPhone(), error: req.t('login.error')
    });
  }
  return completeSignIn(req, res, current.user, current.pending);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- change password (forced after a staff reset, or from settings) ----------
router.get('/change-password', requireAuth, (req, res) => {
  res.render('auth/change', { title: req.t('change.title'), error: null });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const password = req.body.password || '';
  if (password.length < MIN_PASSWORD) {
    return res.status(400).render('auth/change', {
      title: req.t('change.title'),
      error: req.t('signup.error_password', { min: MIN_PASSWORD })
    });
  }

  await req.user.update({ passwordHash: await bcrypt.hash(password, BCRYPT_COST), mustChangePassword: false });
  req.flash('success', req.t('change.done'));
  res.redirect(req.user.role === 'admin' ? '/admin' : '/events');
});

module.exports = router;
