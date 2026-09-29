// Phase 2: Find Seniors, messages, report, block, notifications
const express = require('express');
const { Op } = require('sequelize');
const { User, Message, Skip, Block, Report, ReportHide, Notification } = require('../models');
const social = require('../services/social');
const { sendMessage, MAX_MESSAGE } = require('../services/messaging');
const cloud = require('../services/cloudinary');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { idUpload } = require('../middleware/upload');
const { uploadLimiter, messageLimiter } = require('../middleware/rateLimit');
const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('seniorId', numericId);
router.param('id', numericId);

const PAGE_SIZE = 50;

// ---------- Find Seniors ----------
router.get('/find-seniors', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin');

  let next = null;
  if (req.user.verificationStatus === 'approved') {
    next = await social.nextSeniorFor(req.user);
  }
  res.render('social/find', { title: req.t('find.title'), next });
});

router.post('/find-seniors/id', requireAuth, uploadLimiter, idUpload('idDocument'), async (req, res) => {
  const user = req.user;
  if (!['unverified', 'rejected'].includes(user.verificationStatus)) return res.redirect('/find-seniors');

  if (req.uploadError) {
    req.flash('error', req.uploadError);
    return res.redirect('/find-seniors');
  }
  if (!req.file) {
    req.flash('error', req.t('upload.no_file_id'));
    return res.redirect('/find-seniors');
  }
  if (!cloud.isConfigured()) {
    req.flash('error', req.t('upload.not_setup'));
    return res.redirect('/find-seniors');
  }

  try {
    const uploaded = await cloud.uploadBuffer(req.file.buffer, 'id');
    const oldPublicId = user.idDocumentPublicId;
    await user.update({
      idDocumentPublicId: uploaded.publicId,
      idDocumentFormat: uploaded.format,
      verificationStatus: 'pending',
      verificationRejectionReason: null
    });
    await cloud.deleteFile(oldPublicId, 'private');
    await social.notifyAdmins('admin.id_submitted', { name: user.fullName }, '/admin/ids');
    req.flash('success', req.t('find.id_sent'));
  } catch (err) {
    console.error('ID upload failed:', err.message);
    req.flash('error', req.t('upload.failed_id'));
  }
  res.redirect('/find-seniors');
});

router.post('/find-seniors/:id/skip', requireVerified, async (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id) {
    await Skip.findOrCreate({ where: { seniorId: req.user.id, skippedId: id } });
  }
  res.redirect('/find-seniors');
});

// ---------- report ----------
async function loadOtherSenior(req, res) {
  const other = await User.findOne({ where: { id: req.params.seniorId, role: 'senior' } });
  if (!other || other.id === req.user.id) {
    res.status(404).render('error', { title: req.t('error.not_found_title'), message: req.t('error.not_found') });
    return null;
  }
  return other;
}

router.get('/report/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  res.render('social/report', { title: req.t('report.title'), other });
});

router.post('/report/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;

  // keep a copy of the last messages so staff can see what happened
  const messages = await Message.findAll({
    where: {
      [Op.or]: [
        { senderId: req.user.id, recipientId: other.id },
        { senderId: other.id, recipientId: req.user.id }
      ]
    },
    order: [['createdAt', 'DESC']],
    limit: 50
  });
  const snapshot = messages.reverse().map((m) => ({
    from: m.senderId === req.user.id ? 'reporter' : 'reported',
    body: m.body,
    at: m.createdAt
  }));

  const report = await Report.create({
    reporterId: req.user.id,
    reportedId: other.id,
    conversationSnapshot: snapshot,
    reason: (req.body.reason || '').trim().slice(0, 1000) || null
  });
  await ReportHide.findOrCreate({
    where: { reporterId: req.user.id, reportedId: other.id },
    defaults: { reportId: report.id }
  });
  await social.notifyAdmins('admin.new_report', {}, '/admin/reports/' + report.id);

  req.flash('success', req.t('report.done'));
  res.redirect('/find-seniors');
});

// ---------- block ----------
router.get('/block/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  res.render('social/block', { title: req.t('block.title'), other });
});

router.post('/block/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  await Block.findOrCreate({ where: { blockerId: req.user.id, blockedId: other.id } });
  req.flash('success', req.t('block.done'));
  res.redirect('/messages');
});

// ---------- messages ----------

// list of conversations, newest first
router.get('/messages', requireVerified, async (req, res) => {
  const me = req.user.id;
  const recent = await Message.findAll({
    where: { [Op.or]: [{ senderId: me }, { recipientId: me }] },
    order: [['createdAt', 'DESC']],
    limit: 300
  });

  // keep only the latest message with each person
  const latest = new Map();
  for (const m of recent) {
    const otherId = m.senderId === me ? m.recipientId : m.senderId;
    if (!latest.has(otherId)) latest.set(otherId, m);
  }

  const people = await User.findAll({ where: { id: Array.from(latest.keys()) } });
  const conversations = [];
  for (const person of people) {
    if (await social.isBlockedOrHidden(me, person.id)) continue;
    conversations.push({ person, last: latest.get(person.id) });
  }
  conversations.sort((a, b) => b.last.createdAt - a.last.createdAt);

  const unreadFrom = await Notification.findAll({
    where: { userId: me, type: 'message.new', readAt: null },
    attributes: ['payload']
  });
  const unreadIds = new Set(unreadFrom.map((n) => n.payload.senderId));

  res.render('social/inbox', { title: req.t('messages.title'), conversations, unreadIds });
});

router.get('/messages/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;

  if (!(await social.canMessage(req.user, other))) {
    return res.render('error', { title: req.t('messages.title'), message: req.t('messages.unavailable') });
  }

  const where = {
    [Op.or]: [
      { senderId: req.user.id, recipientId: other.id },
      { senderId: other.id, recipientId: req.user.id }
    ]
  };
  // "show older messages" uses ?before=<message id>
  if (/^\d+$/.test(req.query.before || '')) where.id = { [Op.lt]: Number(req.query.before) };

  const page = await Message.findAll({ where, order: [['id', 'DESC']], limit: PAGE_SIZE + 1 });
  const hasOlder = page.length > PAGE_SIZE;
  const messages = page.slice(0, PAGE_SIZE).reverse();

  // mark this conversation's message notifications as read
  await Notification.update(
    { readAt: new Date() },
    { where: { userId: req.user.id, type: 'message.new', readAt: null, payload: { senderId: other.id } } }
  );

  res.render('social/thread', {
    title: other.firstName(),
    other,
    messages,
    olderLink: hasOlder ? '/messages/' + other.id + '?before=' + messages[0].id : null
  });
});

router.post('/messages/:seniorId', requireVerified, messageLimiter, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;

  const result = await sendMessage(req.app.get('io'), req.user, other, req.body.body);

  // same message whether they're blocked, reported or removed. Don't say why.
  if (result.reason === 'unavailable') {
    return res.status(403).render('error', { title: req.t('messages.title'), message: req.t('messages.unavailable') });
  }
  if (result.reason === 'too_long') {
    req.flash('error', req.t('messages.too_long', { max: MAX_MESSAGE }));
  }
  res.redirect('/messages/' + other.id + '#latest');
});

// ---------- notifications ----------
router.get('/notifications', requireAuth, async (req, res) => {
  const notifications = await Notification.findAll({
    where: { userId: req.user.id },
    order: [['createdAt', 'DESC']],
    limit: 50
  });
  // opening the page counts as reading everything except unread messages
  await Notification.update(
    { readAt: new Date() },
    { where: { userId: req.user.id, readAt: null, type: { [Op.ne]: 'message.new' } } }
  );
  res.render('social/notifications', { title: req.t('notifications.title'), notifications });
});

module.exports = router;
