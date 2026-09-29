const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, User, Organization, Event, Registration, EventInterest, Report, Notification, OnboardingVideo } = require('../models');
const capacity = require('../services/capacity');
const cloud = require('../services/cloudinary');
const { notify } = require('../services/notify');
const { audit } = require('../services/audit');
const { shortDate, fromLocalInput, toLocalInput, DAY_MS } = require('../services/dates');
const { requireAdmin } = require('../middleware/auth');
const { imageUpload, videoUpload } = require('../middleware/upload');
const { removeFromSocial, deleteAccount } = require('../services/removal');
const { addNotification } = require('../services/social');

const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('id', numericId);
router.param('userId', numericId);
router.use(requireAdmin);

// ---------- dashboard ----------
router.get('/', async (req, res) => {
  const now = new Date();

  const upcoming = await Event.findAll({
    where: { status: 'published', startsAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + 14 * DAY_MS) } },
    include: [Organization],
    order: [['startsAt', 'ASC']]
  });
  for (const event of upcoming) {
    event.taken = await capacity.countTaken(event.id, 'attendee');
    event.volunteersTaken = event.volunteerEnabled ? await capacity.countTaken(event.id, 'volunteer') : 0;
  }

  // ended events where some registrations still haven't been marked
  const needsAttendance = await Event.findAll({
    where: { endsAt: { [Op.lt]: now }, status: { [Op.ne]: 'cancelled' } },
    include: [{ model: Registration, where: { status: 'registered' }, attributes: ['id'] }],
    order: [['startsAt', 'DESC']],
    limit: 10
  });

  const seniorCount = await User.count({ where: { role: 'senior' } });

  const noShows = await Registration.findAll({
    attributes: ['seniorId', [sequelize.fn('COUNT', '*'), 'total']],
    where: { status: 'no_show' },
    include: [{ model: User, as: 'senior', attributes: ['fullName', 'phone'] }],
    group: ['seniorId', 'senior.id'],
    order: [[sequelize.literal('total'), 'DESC']],
    limit: 10
  });

  const pendingIds = await User.count({ where: { role: 'senior', verificationStatus: 'pending' } });
  const openReports = await Report.count({ where: { status: 'pending' } });
  const alerts = await Notification.findAll({
    where: { userId: req.user.id, readAt: null },
    order: [['createdAt', 'DESC']],
    limit: 20
  });

  res.render('admin/dashboard', {
    title: 'Admin', upcoming, needsAttendance, seniorCount, noShows, pendingIds, openReports, alerts,
    systemWarnings: req.app.get('startupWarnings') || []
  });
});

router.post('/alerts/read', async (req, res) => {
  await Notification.update({ readAt: new Date() }, { where: { userId: req.user.id, readAt: null } });
  res.redirect('/admin');
});

// ---------- organizations ----------
function orgValues(body) {
  return {
    name: (body.name || '').trim(),
    contactName: (body.contactName || '').trim() || null,
    contactPhone: (body.contactPhone || '').trim() || null,
    contactEmail: (body.contactEmail || '').trim() || null
  };
}

router.get('/organizations', async (req, res) => {
  const organizations = await Organization.findAll({ order: [['name', 'ASC']] });
  res.render('admin/organizations', { title: 'Organizations', organizations, error: null });
});

router.post('/organizations', async (req, res) => {
  const values = orgValues(req.body);
  if (!values.name) {
    const organizations = await Organization.findAll({ order: [['name', 'ASC']] });
    return res.status(400).render('admin/organizations', { title: 'Organizations', organizations, error: 'Please give the organization a name.' });
  }
  const org = await Organization.create({ ...values, createdByAdminId: req.user.id });
  await audit(req.user.id, 'organization.create', 'Organization', org.id);
  req.flash('success', org.name + ' was added.');
  res.redirect('/admin/organizations');
});

router.get('/organizations/:id/edit', async (req, res) => {
  const org = await Organization.findByPk(req.params.id);
  if (!org) return res.redirect('/admin/organizations');
  res.render('admin/organization-edit', { title: 'Edit organization', org, error: null });
});

router.post('/organizations/:id/edit', async (req, res) => {
  const org = await Organization.findByPk(req.params.id);
  if (!org) return res.redirect('/admin/organizations');

  const values = orgValues(req.body);
  if (!values.name) {
    return res.status(400).render('admin/organization-edit', { title: 'Edit organization', org, error: 'Please give the organization a name.' });
  }
  await org.update(values);
  await audit(req.user.id, 'organization.edit', 'Organization', org.id);
  req.flash('success', 'Changes saved.');
  res.redirect('/admin/organizations');
});

// ---------- events ----------

// reads and checks the event form. returns { values, errors }
function readEventForm(body) {
  const values = {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    startsAt: fromLocalInput(body.startsAt),
    endsAt: fromLocalInput(body.endsAt),
    registrationDeadline: fromLocalInput(body.registrationDeadline),
    locationText: (body.locationText || '').trim(),
    locationMapsUrl: (body.locationMapsUrl || '').trim() || null,
    category: body.category,
    organizationId: Number(body.organizationId) || null,
    capacity: parseInt(body.capacity, 10),
    volunteerEnabled: body.volunteerEnabled === 'yes',
    volunteerCapacity: parseInt(body.volunteerCapacity, 10) || null,
    hostedBySenior: body.hostedBySenior === 'yes'
  };

  const errors = {};
  if (!values.title) errors.title = 'Add a title.';
  if (!values.description) errors.description = 'Add a short description.';
  if (!values.startsAt) errors.startsAt = 'Pick a start date and time.';
  if (!values.endsAt) errors.endsAt = 'Pick an end date and time.';
  if (values.startsAt && values.endsAt && values.endsAt <= values.startsAt) errors.endsAt = 'The event has to end after it starts.';
  if (!values.registrationDeadline) errors.registrationDeadline = 'Pick a registration deadline.';
  if (values.registrationDeadline && values.startsAt && values.registrationDeadline > values.startsAt) {
    errors.registrationDeadline = 'The deadline has to be before the event starts.';
  }
  if (!values.locationText) errors.locationText = 'Add where the event is.';
  if (values.locationMapsUrl && !/^https?:\/\//.test(values.locationMapsUrl)) errors.locationMapsUrl = 'This should be a link starting with https://';
  if (!Event.CATEGORIES.includes(values.category)) errors.category = 'Pick a category.';
  if (!values.organizationId) errors.organizationId = 'Pick an organization.';
  if (!(values.capacity > 0)) errors.capacity = 'Capacity has to be at least 1.';
  if (values.volunteerEnabled && !(values.volunteerCapacity > 0)) errors.volunteerCapacity = 'How many volunteers are needed?';
  if (!values.volunteerEnabled) values.volunteerCapacity = null;

  return { values, errors };
}

// the form keeps what the admin typed, so turn dates back into input strings
function formValues(values) {
  return {
    ...values,
    startsAt: toLocalInput(values.startsAt),
    endsAt: toLocalInput(values.endsAt),
    registrationDeadline: toLocalInput(values.registrationDeadline)
  };
}

async function renderEventForm(res, status, options) {
  const organizations = await Organization.findAll({ order: [['name', 'ASC']] });
  res.status(status).render('admin/event-form', {
    title: options.event ? 'Edit event' : 'New event',
    organizations,
    categories: Event.CATEGORIES,
    event: null,
    errors: {},
    ...options
  });
}

// uploads the image if one was picked. returns an error message or null
async function handleEventImage(req, event) {
  if (req.uploadError) return req.uploadError;
  if (!req.file) return null;
  if (!cloud.isConfigured()) return 'Image uploads are not set up yet (add the Cloudinary keys to .env). The event was saved without it.';

  try {
    const uploaded = await cloud.uploadBuffer(req.file.buffer, 'event');
    const oldPublicId = event.imagePublicId;
    await event.update({ imageUrl: uploaded.url, imagePublicId: uploaded.publicId });
    await cloud.deleteFile(oldPublicId);
    return null;
  } catch (err) {
    console.error('Event image upload failed:', err.message);
    return 'The event was saved, but the image did not upload. Try again from the edit page.';
  }
}

// tells seniors who asked about this kind of event
async function notifyInterestedSeniors(event) {
  const interests = await EventInterest.findAll({
    where: { category: event.category, notifiedAt: null },
    include: [{ model: User, as: 'senior' }]
  });

  for (const interest of interests) {
    if (!interest.senior) continue; // account was deleted
    const senior = interest.senior;
    notify(senior, 'event.similar', {
      name: senior.firstName(),
      event: event.title,
      date: shortDate(event.startsAt),
      link: process.env.APP_URL + '/events/' + event.id
    });
    await interest.update({ notifiedAt: new Date() });
  }
  return interests.length;
}

router.get('/events', async (req, res) => {
  const events = await Event.findAll({ include: [Organization], order: [['startsAt', 'DESC']] });
  res.render('admin/events', { title: 'Events', events });
});

router.get('/events/new', async (req, res) => {
  const count = await Organization.count();
  if (count === 0) {
    req.flash('info', 'Add an organization first. Every event belongs to one.');
    return res.redirect('/admin/organizations');
  }
  await renderEventForm(res, 200, { values: { capacity: 20 } });
});

router.post('/events', imageUpload('image', 3), async (req, res) => {
  const { values, errors } = readEventForm(req.body || {});
  if (Object.keys(errors).length > 0) {
    return renderEventForm(res, 400, { values: formValues(values), errors });
  }

  const event = await Event.create({ ...values, createdByAdminId: req.user.id });
  await audit(req.user.id, 'event.create', 'Event', event.id);

  const imageError = await handleEventImage(req, event);
  const told = await notifyInterestedSeniors(event);

  if (imageError) req.flash('error', imageError);
  else req.flash('success', 'Event published.' + (told ? ' ' + told + ' senior(s) who asked about ' + event.category + ' events were told.' : ''));
  res.redirect('/admin/events');
});

router.get('/events/:id/edit', async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  if (!event) return res.redirect('/admin/events');
  await renderEventForm(res, 200, { event, values: formValues(event.get({ plain: true })) });
});

router.post('/events/:id/edit', imageUpload('image', 3), async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  if (!event) return res.redirect('/admin/events');

  const { values, errors } = readEventForm(req.body || {});
  if (Object.keys(errors).length > 0) {
    return renderEventForm(res, 400, { event, values: formValues(values), errors });
  }

  await event.update(values);
  await audit(req.user.id, 'event.edit', 'Event', event.id);

  const imageError = await handleEventImage(req, event);
  if (imageError) req.flash('error', imageError);
  else req.flash('success', 'Changes saved.');
  res.redirect('/admin/events');
});

router.post('/events/:id/cancel', async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  if (!event || event.status !== 'published') return res.redirect('/admin/events');

  await event.update({ status: 'cancelled' });
  await audit(req.user.id, 'event.cancel', 'Event', event.id);

  const registrations = await Registration.findAll({
    where: { eventId: event.id, status: 'registered' },
    include: [{ model: User, as: 'senior' }]
  });
  for (const reg of registrations) {
    if (!reg.senior) continue;
    notify(reg.senior, 'event.cancelled_by_admin', {
      name: reg.senior.firstName(),
      event: event.title,
      date: shortDate(event.startsAt)
    });
  }

  req.flash('success', event.title + ' was cancelled. ' + registrations.length + ' senior(s) were told.');
  res.redirect('/admin/events');
});

// ---------- attendance ----------
router.get('/events/:id/attendance', async (req, res) => {
  const event = await Event.findByPk(req.params.id, { include: [Organization] });
  if (!event) return res.redirect('/admin/events');

  const registrations = await Registration.findAll({
    where: { eventId: event.id, status: { [Op.in]: ['registered', 'attended', 'no_show'] } },
    include: [{ model: User, as: 'senior', paranoid: false }],
    order: [['type', 'ASC'], [{ model: User, as: 'senior' }, 'fullName', 'ASC']]
  });

  res.render('admin/attendance', {
    title: 'Attendance',
    event,
    registrations,
    hasStarted: new Date(event.startsAt) <= new Date()
  });
});

router.post('/events/:id/attendance', async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  if (!event) return res.redirect('/admin/events');

  // form fields look like status_12 = attended | no_show | registered
  const allowed = ['registered', 'attended', 'no_show'];
  let changed = 0;

  const registrations = await Registration.findAll({
    where: { eventId: event.id, status: { [Op.in]: allowed } }
  });
  for (const reg of registrations) {
    const newStatus = req.body['status_' + reg.id];
    if (allowed.includes(newStatus) && newStatus !== reg.status) {
      await reg.update({ status: newStatus });
      changed++;
    }
  }

  await audit(req.user.id, 'attendance.record', 'Event', event.id, { changed });
  req.flash('success', 'Attendance saved.');
  res.redirect('/admin/events/' + event.id + '/attendance');
});

// ---------- seniors ----------
router.get('/seniors', async (req, res) => {
  const q = (req.query.q || '').trim();
  const where = { role: 'senior' };
  if (q) {
    where[Op.or] = [
      { fullName: { [Op.iLike]: '%' + q + '%' } },
      { phone: { [Op.iLike]: '%' + q.replace(/^0/, '') + '%' } }
    ];
  }
  const seniors = await User.findAll({ where, order: [['fullName', 'ASC']], limit: 50 });
  res.render('admin/seniors', { title: 'Seniors', seniors, q, tempPassword: null });
});

router.post('/seniors/:id/reset-password', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.id, role: 'senior' } });
  if (!senior) return res.redirect('/admin/seniors');

  // short and easy to read out over the phone
  const tempPassword = 'padi' + crypto.randomInt(1000, 9999);
  await senior.update({ passwordHash: await bcrypt.hash(tempPassword, 12), mustChangePassword: true });
  await audit(req.user.id, 'senior.reset_password', 'User', senior.id);

  notify(senior, 'auth.temp_password', { name: senior.firstName(), password: tempPassword }, ['sms']);

  req.flash('success', 'Password reset for ' + senior.fullName + '. We texted them: ' + tempPassword + '. They will pick a new one when they log in.');
  res.redirect('/admin/seniors?q=' + encodeURIComponent(senior.phone));
});

router.post('/seniors/:id/remove-from-social', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.id, role: 'senior' } });
  if (!senior) return res.redirect('/admin/seniors');
  await removeFromSocial(senior, req.user.id);
  req.flash('success', senior.fullName + ' was removed from Find Seniors and messages. Their event places are unchanged.');
  res.redirect('/admin/seniors?q=' + encodeURIComponent(senior.phone));
});

router.post('/seniors/:id/delete', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.id, role: 'senior' } });
  if (!senior) return res.redirect('/admin/seniors');
  const cancelled = await deleteAccount(senior, req.user.id);
  req.flash('success', senior.fullName + "'s account was deleted. " + cancelled + ' upcoming place(s) were freed. Past attendance is kept.');
  res.redirect('/admin/seniors');
});

// ---------- ID checks ----------
router.get('/ids', async (req, res) => {
  const pending = await User.findAll({
    where: { role: 'senior', verificationStatus: 'pending' },
    order: [['updatedAt', 'ASC']]
  });
  res.render('admin/ids', { title: 'ID checks', pending });
});

// never shows the Cloudinary link on a page. Makes a 5-minute signed link and redirects.
router.get('/ids/:userId/view', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.userId, role: 'senior' } });
  if (!senior || !senior.idDocumentPublicId) return res.redirect('/admin/ids');

  await audit(req.user.id, 'id.view', 'User', senior.id);
  res.set('Cache-Control', 'no-store');
  res.redirect(cloud.signedIdUrl(senior.idDocumentPublicId, senior.idDocumentFormat || 'jpg'));
});

router.post('/ids/:userId/approve', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.userId, role: 'senior', verificationStatus: 'pending' } });
  if (!senior) return res.redirect('/admin/ids');

  await senior.update({ verificationStatus: 'approved', verificationRejectionReason: null });
  await audit(req.user.id, 'id.approve', 'User', senior.id);
  notify(senior, 'id.approved', { name: senior.firstName() });
  await addNotification(senior.id, 'id.approved', {}, '/find-seniors');

  req.flash('success', senior.fullName + ' is verified. They can now use Find Seniors.');
  res.redirect('/admin/ids');
});

router.post('/ids/:userId/reject', async (req, res) => {
  const senior = await User.findOne({ where: { id: req.params.userId, role: 'senior', verificationStatus: 'pending' } });
  if (!senior) return res.redirect('/admin/ids');

  const reason = (req.body.reason || '').trim();
  if (!reason) {
    req.flash('error', 'Please write a short reason so ' + senior.firstName() + ' knows what to fix.');
    return res.redirect('/admin/ids');
  }

  // rejecting never touches event access
  await senior.update({ verificationStatus: 'rejected', verificationRejectionReason: reason });
  await audit(req.user.id, 'id.reject', 'User', senior.id, { reason });
  notify(senior, 'id.rejected', { name: senior.firstName(), reason });
  await addNotification(senior.id, 'id.rejected', { reason }, '/find-seniors');

  req.flash('success', 'ID sent back to ' + senior.fullName + ' with your reason.');
  res.redirect('/admin/ids');
});

// ---------- reports ----------
router.get('/reports', async (req, res) => {
  const include = [
    { model: User, as: 'reporter', paranoid: false },
    { model: User, as: 'reported', paranoid: false }
  ];
  const pending = await Report.findAll({ where: { status: 'pending' }, include, order: [['createdAt', 'ASC']] });
  const recent = await Report.findAll({
    where: { status: { [Op.ne]: 'pending' } },
    include,
    order: [['reviewedAt', 'DESC']],
    limit: 20
  });
  res.render('admin/reports', { title: 'Reports', pending, recent });
});

router.get('/reports/:id', async (req, res) => {
  const report = await Report.findByPk(req.params.id, {
    include: [
      { model: User, as: 'reporter', paranoid: false },
      { model: User, as: 'reported', paranoid: false }
    ]
  });
  if (!report) return res.redirect('/admin/reports');
  const otherReports = await Report.count({ where: { reportedId: report.reportedId, id: { [Op.ne]: report.id } } });
  res.render('admin/report', { title: 'Report', report, otherReports });
});

router.post('/reports/:id/resolve', async (req, res) => {
  const report = await Report.findByPk(req.params.id, { include: [{ model: User, as: 'reported' }] });
  if (!report || report.status !== 'pending') return res.redirect('/admin/reports');

  const action = req.body.action;
  const reported = report.reported; // null if they already deleted their account

  if (action === 'warn' && reported) {
    notify(reported, 'account.warned', { name: reported.firstName() }, ['sms']);
    await addNotification(reported.id, 'account.warned', {});
    await report.update({ status: 'warned' });
  } else if (action === 'remove' && reported) {
    await removeFromSocial(reported, req.user.id);
    await report.update({ status: 'removed' });
  } else if (action === 'dismiss') {
    // the reporter's hide stays. Their safety choice isn't undone.
    await report.update({ status: 'dismissed' });
  } else {
    return res.redirect('/admin/reports/' + report.id);
  }

  await report.update({ reviewedByAdminId: req.user.id, reviewedAt: new Date() });
  await audit(req.user.id, 'report.resolve', 'Report', report.id, { action });
  req.flash('success', 'Report closed.');
  res.redirect('/admin/reports');
});

// ---------- QR check-in (optional, same record as the manual list) ----------
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findByQr(token) {
  if (!UUID_PATTERN.test(token)) return null;
  return Registration.findOne({
    where: { qrToken: token },
    include: [Event, { model: User, as: 'senior', paranoid: false }]
  });
}

router.get('/scan/:qrToken', async (req, res) => {
  const registration = await findByQr(req.params.qrToken);
  res.render('admin/scan', { title: 'Check in', registration });
});

router.post('/scan/:qrToken', async (req, res) => {
  const registration = await findByQr(req.params.qrToken);
  if (!registration) return res.redirect('/admin/scan/' + req.params.qrToken);

  if (['registered', 'no_show'].includes(registration.status)) {
    await registration.update({ status: 'attended' });
    await audit(req.user.id, 'attendance.qr', 'Registration', registration.id);
  }
  req.flash('success', (registration.senior ? registration.senior.fullName : 'Senior') + ' is checked in.');
  res.redirect('/admin/scan/' + req.params.qrToken);
});

// ---------- onboarding video ----------
router.get('/onboarding-video', async (req, res) => {
  const videos = {
    en: await OnboardingVideo.findOne({ where: { language: 'en' } }),
    yo: await OnboardingVideo.findOne({ where: { language: 'yo' } })
  };
  res.render('admin/onboarding-video', { title: 'Welcome video', videos });
});

router.post('/onboarding-video/:lang', videoUpload('video'), async (req, res) => {
  const lang = req.params.lang === 'yo' ? 'yo' : 'en';
  const transcript = ((req.body && req.body.transcript) || '').trim();

  if (req.uploadError) {
    req.flash('error', req.uploadError);
    return res.redirect('/admin/onboarding-video');
  }
  if (!transcript) {
    req.flash('error', 'Please add the transcript. Seniors who can\'t play the video read it instead.');
    return res.redirect('/admin/onboarding-video');
  }

  let video = await OnboardingVideo.findOne({ where: { language: lang } });
  if (!video) video = OnboardingVideo.build({ language: lang });
  video.transcript = transcript;
  video.uploadedByAdminId = req.user.id;

  if (req.file) {
    if (!cloud.isConfigured()) {
      req.flash('error', 'Video uploads need the Cloudinary keys in .env. The transcript was saved.');
      await video.save();
      return res.redirect('/admin/onboarding-video');
    }
    try {
      const uploaded = await cloud.uploadBuffer(req.file.buffer, 'video');
      await cloud.deleteFile(video.videoPublicId, 'upload', 'video');
      video.videoUrl = uploaded.url;
      video.videoPublicId = uploaded.publicId;
    } catch (err) {
      console.error('Video upload failed:', err.message);
      await video.save();
      req.flash('error', 'The video did not upload (the transcript was saved). Try again.');
      return res.redirect('/admin/onboarding-video');
    }
  }

  await video.save();
  await audit(req.user.id, 'onboarding_video.update', 'OnboardingVideo', video.id, { lang, newVideo: Boolean(req.file) });
  req.flash('success', (lang === 'yo' ? 'Yorùbá' : 'English') + ' welcome video saved.');
  res.redirect('/admin/onboarding-video');
});

// ---------- staff accounts ----------
router.get('/staff', async (req, res) => {
  const staff = await User.findAll({ where: { role: 'admin' }, order: [['fullName', 'ASC']] });
  res.render('admin/staff', { title: 'Staff', staff, errors: {}, values: {} });
});

router.post('/staff', async (req, res) => {
  const { normalizePhone } = require('../services/phone');
  const values = {
    fullName: (req.body.fullName || '').trim(),
    phone: (req.body.phone || '').trim(),
    email: (req.body.email || '').trim().toLowerCase()
  };
  const phone = normalizePhone(values.phone);
  const errors = {};
  if (values.fullName.length < 2) errors.fullName = 'Add their full name.';
  if (!phone) errors.phone = 'Add a Nigerian phone number, like 0803 123 4567.';

  let existing = null;
  if (phone) existing = await User.findOne({ where: { phone }, paranoid: false });
  if (existing && existing.role === 'admin' && !existing.deletedAt) errors.phone = 'This person is already staff.';

  if (Object.keys(errors).length > 0) {
    const staff = await User.findAll({ where: { role: 'admin' }, order: [['fullName', 'ASC']] });
    return res.status(400).render('admin/staff', { title: 'Staff', staff, errors, values });
  }

  const tempPassword = 'padi' + crypto.randomInt(100000, 999999);
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  let member;
  if (existing) {
    // they already have a senior account (or a removed one): turn it into staff
    if (existing.deletedAt) await existing.restore();
    member = await existing.update({ role: 'admin', passwordHash, mustChangePassword: true, fullName: values.fullName });
  } else {
    member = await User.create({
      fullName: values.fullName,
      phone,
      email: values.email || null,
      passwordHash,
      role: 'admin',
      mustChangePassword: true,
      onboardingSeenAt: new Date()
    });
  }

  await audit(req.user.id, 'staff.add', 'User', member.id);
  notify(member, 'auth.temp_password', { name: member.firstName(), password: tempPassword }, ['sms']);
  req.flash('success', member.fullName + ' can now log in with ' + member.phone + ' and the temporary password ' + tempPassword + ' (also sent by SMS). They will choose their own password when they log in.');
  res.redirect('/admin/staff');
});

router.post('/staff/:id/reset-password', async (req, res) => {
  const member = await User.findOne({ where: { id: req.params.id, role: 'admin' } });
  if (!member) return res.redirect('/admin/staff');

  const tempPassword = 'padi' + crypto.randomInt(100000, 999999);
  await member.update({ passwordHash: await bcrypt.hash(tempPassword, 12), mustChangePassword: true });
  await audit(req.user.id, 'staff.reset_password', 'User', member.id);
  notify(member, 'auth.temp_password', { name: member.firstName(), password: tempPassword }, ['sms']);
  req.flash('success', 'New temporary password for ' + member.fullName + ': ' + tempPassword + ' (also sent by SMS).');
  res.redirect('/admin/staff');
});

router.post('/staff/:id/remove', async (req, res) => {
  const member = await User.findOne({ where: { id: req.params.id, role: 'admin' } });
  if (!member) return res.redirect('/admin/staff');

  if (member.id === req.user.id) {
    req.flash('error', "You can't remove your own account. Ask another staff member to do it.");
    return res.redirect('/admin/staff');
  }
  const count = await User.count({ where: { role: 'admin' } });
  if (count <= 1) {
    req.flash('error', 'There has to be at least one staff account.');
    return res.redirect('/admin/staff');
  }

  await member.destroy(); // soft delete: their past actions in the audit log stay
  await audit(req.user.id, 'staff.remove', 'User', member.id);
  req.flash('success', member.fullName + ' no longer has staff access.');
  res.redirect('/admin/staff');
});

// ---------- system status ----------
router.get('/system', async (req, res) => {
  const { migrationStatus } = require('../services/migrate');
  const { lastRuns } = require('../services/cron');

  let dbOk = true;
  let migrations = { executed: [], pending: [] };
  try {
    await sequelize.authenticate();
    migrations = await migrationStatus(sequelize);
  } catch (err) {
    dbOk = false;
  }

  const brevo = !process.env.BREVO_API_KEY ? 'off' : (process.env.NOTIFY_DRY_RUN === 'true' ? 'test' : 'on');
  const counts = {
    seniors: await User.count({ where: { role: 'senior' } }),
    upcomingEvents: await Event.count({ where: { status: 'published', startsAt: { [Op.gt]: new Date() } } }),
    registrations: await Registration.count({ where: { status: 'registered' } })
  };

  res.render('admin/system', {
    title: 'System',
    dbOk,
    dbHost: sequelize.config.host,
    migrations,
    brevo,
    cloudinary: cloud.isConfigured(),
    appUrl: process.env.APP_URL,
    startedAt: req.app.get('startedAt'),
    warnings: req.app.get('startupWarnings') || [],
    lastRuns,
    counts
  });
});

module.exports = router;
