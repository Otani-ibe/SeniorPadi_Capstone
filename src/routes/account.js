const express = require('express');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const { Event, Organization, Registration } = require('../models');
const { notify } = require('../services/notify');
const cloud = require('../services/cloudinary');
const { shortDate } = require('../services/dates');
const { requireAuth } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { deleteAccount } = require('../services/removal');
const { qrSvg } = require('../services/qr');
const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('id', numericId);

// ---------- my registrations (upcoming) ----------
router.get('/registrations', requireAuth, async (req, res) => {
  const registrations = await Registration.findAll({
    where: { seniorId: req.user.id, status: 'registered' },
    include: [{ model: Event, where: { endsAt: { [Op.gt]: new Date() } }, include: [Organization] }],
    order: [[Event, 'startsAt', 'ASC']]
  });
  for (const reg of registrations) reg.qr = await qrSvg(reg.qrToken);
  res.render('account/registrations', { title: req.t('registrations.title'), registrations });
});

router.post('/registrations/:id/cancel', requireAuth, async (req, res) => {
  const registration = await Registration.findOne({
    where: { id: req.params.id, seniorId: req.user.id, status: 'registered' },
    include: [Event]
  });

  if (!registration || new Date(registration.Event.startsAt) <= new Date()) {
    req.flash('error', req.t('registrations.cannot_cancel'));
    return res.redirect('/registrations');
  }

  await registration.update({ status: 'cancelled' });
  notify(req.user, 'event.cancelled', {
    name: req.user.firstName(),
    event: registration.Event.title,
    date: shortDate(registration.Event.startsAt)
  }, ['sms']);

  req.flash('success', req.t('registrations.cancelled', { event: registration.Event.title }));
  res.redirect('/registrations');
});

// ---------- history (events that have ended) ----------
router.get('/history', requireAuth, async (req, res) => {
  const registrations = await Registration.findAll({
    where: { seniorId: req.user.id },
    include: [{ model: Event, where: { endsAt: { [Op.lte]: new Date() } } }],
    order: [[Event, 'startsAt', 'DESC']]
  });
  res.render('account/history', { title: req.t('history.title'), registrations });
});

// ---------- settings ----------
router.get('/settings', requireAuth, (req, res) => {
  res.render('account/settings', { title: req.t('settings.title'), errors: {} });
});

router.post('/settings', requireAuth, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const errors = {};
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.email = req.t('signup.error_email');

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('account/settings', { title: req.t('settings.title'), errors });
  }

  const days = Number(req.body.reminderDaysBefore);
  try {
    await req.user.update({
      preferredLanguage: req.body.preferredLanguage === 'yo' ? 'yo' : 'en',
      reminderDaysBefore: [1, 2, 3].includes(days) ? days : 1,
      email: email || null,
      area: (req.body.area || '').trim() || null,
      bio: (req.body.bio || '').trim().slice(0, 500) || null
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).render('account/settings', {
        title: req.t('settings.title'),
        errors: { email: req.t('signup.error_email_taken') }
      });
    }
    throw err;
  }

  req.flash('success', req.t('settings.saved', { days: req.user.reminderDaysBefore }));
  res.redirect('/settings');
});

router.post('/settings/profile-picture', requireAuth, uploadLimiter, imageUpload('picture', 2), async (req, res) => {
  if (req.uploadError) {
    req.flash('error', req.uploadError);
    return res.redirect('/settings');
  }
  if (!req.file) {
    req.flash('error', req.t('upload.no_file'));
    return res.redirect('/settings');
  }
  if (!cloud.isConfigured()) {
    req.flash('error', req.t('upload.not_setup'));
    return res.redirect('/settings');
  }

  try {
    const uploaded = await cloud.uploadBuffer(req.file.buffer, 'profile');
    const oldPublicId = req.user.profilePicturePublicId;
    await req.user.update({ profilePictureUrl: uploaded.url, profilePicturePublicId: uploaded.publicId });
    await cloud.deleteFile(oldPublicId);
    req.flash('success', req.t('upload.picture_done'));
  } catch (err) {
    console.error('Profile picture upload failed:', err.message);
    req.flash('error', req.t('upload.failed'));
  }
  res.redirect('/settings');
});

// ---------- delete account ----------
router.get('/account/delete', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin');
  res.render('account/delete', { title: req.t('delete.title'), error: null });
});

router.post('/account/delete', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin');

  // ask for the password so nobody deletes it by accident
  const ok = await bcrypt.compare(req.body.password || '', req.user.passwordHash);
  if (!ok) {
    return res.status(400).render('account/delete', { title: req.t('delete.title'), error: req.t('delete.wrong_password') });
  }

  await deleteAccount(req.user, req.user.id);
  const lang = req.lang;
  req.session.regenerate(() => {
    req.session.lang = lang;
    req.flash('success', req.t('delete.done'));
    res.redirect('/');
  });
});

module.exports = router;
