const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, PasswordReset } = require('../models');
const { normalizePhone } = require('../services/phone');
const { sendEmail } = require('../services/notify');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, signupLimiter, resetLimiter } = require('../middleware/rateLimit');

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

router.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/events');
  res.render('home', { title: 'SeniorPadi' });
});

// switch language (works logged in or out)
router.post('/language', async (req, res) => {
  const lang = req.body.lang === 'yo' ? 'yo' : 'en';
  if (req.user) await req.user.update({ preferredLanguage: lang });
  else req.session.lang = lang;

  const back = req.body.back && req.body.back.startsWith('/') ? req.body.back : '/';
  res.redirect(back);
});

// ---------- sign up ----------
router.get('/signup', (req, res) => {
  res.render('auth/signup', { title: req.t('signup.title'), errors: {}, values: {} });
});

router.post('/signup', signupLimiter, async (req, res) => {
  const values = {
    fullName: (req.body.fullName || '').trim(),
    phone: (req.body.phone || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    ageDeclared: req.body.ageDeclared === 'yes'
  };
  const password = req.body.password || '';
  const errors = {};

  const phone = normalizePhone(values.phone);
  if (values.fullName.length < 2) errors.fullName = req.t('signup.error_name');
  if (!phone) errors.phone = req.t('signup.error_phone');
  if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) errors.email = req.t('signup.error_email');
  if (password.length < MIN_PASSWORD) errors.password = req.t('signup.error_password', { min: MIN_PASSWORD });
  if (!values.ageDeclared) errors.ageDeclared = req.t('signup.error_age');

  if (!errors.phone && await User.findOne({ where: { phone }, paranoid: false })) {
    errors.phone = req.t('signup.error_phone_taken');
  }
  if (values.email && !errors.email && await User.findOne({ where: { email: values.email }, paranoid: false })) {
    errors.email = req.t('signup.error_email_taken');
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('auth/signup', { title: req.t('signup.title'), errors, values });
  }

  const user = await User.create({
    fullName: values.fullName,
    phone,
    email: values.email || null,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    ageDeclared: true,
    preferredLanguage: req.lang
  });

  logIn(req, user);
  req.flash('success', req.t('signup.welcome', { name: user.firstName() }));
  res.redirect('/onboarding');
});

// ---------- log in / out ----------
router.get('/login', (req, res) => {
  res.render('auth/login', { title: req.t('login.title'), error: null, phone: '' });
});

router.post('/login', loginLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = phone ? await User.findOne({ where: { phone } }) : null;
  const passwordOk = user && await bcrypt.compare(req.body.password || '', user.passwordHash);

  if (!passwordOk) {
    return res.status(400).render('auth/login', {
      title: req.t('login.title'),
      error: req.t('login.error'),
      phone: req.body.phone || ''
    });
  }

  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  logIn(req, user);

  if (user.role === 'admin') {
    return res.redirect(returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin');
  }
  if (!user.onboardingSeenAt) return res.redirect('/onboarding'); // e.g. a relative signed them up
  res.redirect(returnTo || '/events');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- forgot password ----------
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot', { title: req.t('forgot.title'), sent: false });
});

router.post('/forgot-password', resetLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = phone ? await User.findOne({ where: { phone } }) : null;

  // only send a link if they have an email. Otherwise staff reset it for them.
  if (user && user.email) {
    const token = crypto.randomBytes(32).toString('hex');
    await PasswordReset.create({
      userId: user.id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    sendEmail(user, 'auth.reset', { name: user.firstName(), link: process.env.APP_URL + '/reset-password/' + token })
      .catch(console.error);
  }

  // same message either way so nobody can check which numbers have accounts
  res.render('auth/forgot', { title: req.t('forgot.title'), sent: true });
});

async function findReset(token) {
  const tokenHash = crypto.createHash('sha256').update(token || '').digest('hex');
  return PasswordReset.findOne({
    where: { tokenHash, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
    include: [User]
  });
}

router.get('/reset-password/:token', async (req, res) => {
  const reset = await findReset(req.params.token);
  if (!reset || !reset.User) {
    return res.render('error', { title: req.t('reset.title'), message: req.t('reset.expired') });
  }
  res.render('auth/reset', { title: req.t('reset.title'), error: null, action: req.originalUrl });
});

router.post('/reset-password/:token', async (req, res) => {
  const reset = await findReset(req.params.token);
  if (!reset || !reset.User) {
    return res.render('error', { title: req.t('reset.title'), message: req.t('reset.expired') });
  }

  const password = req.body.password || '';
  if (password.length < MIN_PASSWORD) {
    return res.status(400).render('auth/reset', {
      title: req.t('reset.title'),
      error: req.t('signup.error_password', { min: MIN_PASSWORD }),
      action: req.originalUrl
    });
  }

  await reset.User.update({ passwordHash: await bcrypt.hash(password, BCRYPT_COST), mustChangePassword: false });
  await reset.update({ usedAt: new Date() });

  logIn(req, reset.User);
  req.flash('success', req.t('reset.done'));
  res.redirect('/events');
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
