// Phase 2: Find Seniors, messages, report, block, notifications
const express = require('express');
const { Op } = require('sequelize');
const { User, Message, Skip, Block, Report, ReportHide, Notification } = require('../models');
const social = require('../services/social');
const { sendMessage, markRead, MAX_MESSAGE } = require('../services/messaging');
const exchange = require('../services/phoneExchange');
const { translateTexts } = require('../services/translate');
const cloud = require('../services/cloudinary');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { uploadLimiter, messageLimiter } = require('../middleware/rateLimit');
const numericId = require('../middleware/numericId');

const router = express.Router();
router.param('seniorId', numericId);

// messaging needs a confirmed phone (and email). Send them to /verify first.
function requireContactVerified(req, res, next) {
  if (req.user.contactVerified()) return next();
  req.session.afterVerify = { next: req.method === 'GET' ? req.originalUrl : '/messages' };
  res.redirect('/verify');
}
router.param('id', numericId);

const PAGE_SIZE = 50;

// ---------- Find Seniors ----------
router.get('/find-seniors', async (req, res) => {
  // not logged in (or session ended): the page shows a log-in pop-up
  if (!req.user) {
    return res.render('social/find', {
      title: req.t('find.title'), wide: true, next: null,
      modalMode: req.query.mode === 'signup' ? 'signup' : 'login'
    });
  }
  if (req.user.role === 'admin') return res.redirect('/admin');
  // not verified yet: the NIN check comes first (someone removed from Find seniors is told so on this page)
  if (req.user.verificationStatus !== 'approved' && req.user.verificationStatus !== 'social_removed') return res.redirect('/identity');

  let next = null;
  let after = [];
  let skippedCount = 0;
  if (req.user.verificationStatus === 'approved') {
    // everything is looked up at the same time
    const [upcoming, skipped] = await Promise.all([social.upcomingSeniorsFor(req.user, 3), social.skippedSeniorsFor(req.user)]);
    next = upcoming[0] || null;
    after = upcoming.slice(1);
    skippedCount = skipped.length;
    if (next && next.bio) next.tBio = (await translateTexts([next.bio], req.lang))[0];
  }
  res.render('social/find', { title: req.t('find.title'), wide: true, next, after, skippedCount });
});

router.post('/find-seniors/:id/skip', requireVerified, async (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id) {
    await Skip.findOrCreate({ where: { seniorId: req.user.id, skippedId: id } });
  }
  res.redirect('/find-seniors');
});

// seniors you skipped: see them again, put them back, or send a message
router.get('/find-seniors/skipped', requireVerified, async (req, res) => {
  const people = await social.skippedSeniorsFor(req.user);
  const bios = await translateTexts(people.map((p) => p.bio || ''), req.lang);
  people.forEach((p, i) => { p.tBio = bios[i]; });
  res.render('social/skipped', { title: req.t('find.skipped_title'), people });
});

router.post('/find-seniors/:id/unskip', requireVerified, async (req, res) => {
  const skip = await Skip.findOne({ where: { seniorId: req.user.id, skippedId: Number(req.params.id) } });
  if (skip) {
    await skip.destroy();
    const person = await User.findByPk(skip.skippedId);
    if (person) req.flash('success', req.t('find.shown_again', { name: person.firstName() }));
  }
  res.redirect('/find-seniors/skipped');
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

// someone's profile: their picture and the whole introduction. Only for people who may message each other.
router.get('/seniors/:seniorId', requireVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  if (!(await social.canMessage(req.user, other))) {
    return res.status(403).render('error', { title: req.t('messages.title'), message: req.t('messages.unavailable') });
  }
  if (other.bio) other.tBio = (await translateTexts([other.bio], req.lang))[0];
  res.render('social/profile', { title: other.firstName(), other });
});

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
    body: m.kind === 'missed_call' ? '[Missed call]' : m.kind === 'call' ? '[Call, ' + m.body + ' seconds]' : m.body,
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

// every conversation, newest first, with what is waiting in each (shown in the list beside a chat)
async function loadConversations(me) {
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

  // what is waiting: new messages, missed calls, swap-number requests and answers. Someone who only sent a swap
  // request (no message yet) is in the list too, so nothing waiting is hidden.
  const alerts = await social.unreadAlerts(me);
  const ids = Array.from(new Set([...latest.keys(), ...alerts.keys()]));

  const people = await User.findAll({ where: { id: ids } });
  const conversations = [];
  for (const person of people) {
    if (await social.isBlockedOrHidden(me, person.id)) continue;
    conversations.push({ person, last: latest.get(person.id) || null, alerts: alerts.get(person.id) || null });
  }
  const when = (c) => (c.last ? c.last.createdAt : new Date(0));
  conversations.sort((a, b) => when(b) - when(a));

  return { conversations, unreadIds: new Set(conversations.filter((c) => c.alerts).map((c) => c.person.id)) };
}

// the chat screens fill the whole screen, so they use the full width and have no footer on phones
const CHAT_PAGE = { fullWidth: true, chatPage: true };

router.get('/messages', requireVerified, requireContactVerified, async (req, res) => {
  const { conversations, unreadIds } = await loadConversations(req.user.id);
  res.render('social/inbox', { title: req.t('messages.title'), conversations, unreadIds, fullWidth: true, noPhoneFooter: true }); // keeps the site menu: it is the way to other pages
});

router.get('/messages/:seniorId', requireVerified, requireContactVerified, async (req, res) => {
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

  // mark this conversation's message notifications as read, and their messages, so they see "Read"
  await social.markConversationRead(req.user.id, other.id);
  await markRead(req.app.get('io'), req.user.id, other.id);
  res.locals.unreadMessages = (await social.unreadSenderIds(req.user.id)).size; // the badge was counted before this was read

  // "Sent" or "Read" goes under the newest message I sent
  // (not on the "older messages" pages)
  const lastMine = req.query.before ? null : messages.filter((m) => m.senderId === req.user.id).pop();

  const ex = await exchange.between(req.user.id, other.id);
  const { conversations, unreadIds } = await loadConversations(req.user.id);
  res.render('social/thread', {
    title: other.firstName(),
    other,
    exchange: ex,
    incomingRequest: Boolean(ex && ex.status === 'pending' && ex.recipientId === req.user.id),
    messages,
    lastMineId: lastMine ? lastMine.id : null,
    olderLink: hasOlder ? '/messages/' + other.id + '?before=' + messages[0].id : null,
    conversations,
    unreadIds,
    ...CHAT_PAGE
  });
});

router.post('/messages/:seniorId', requireVerified, requireContactVerified, messageLimiter, async (req, res) => {
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

// ---------- swap phone numbers ----------
router.post('/messages/:seniorId/exchange', requireVerified, requireContactVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  const result = await exchange.request(req.user, other);
  if (result.ok) req.flash('success', req.t('exchange.sent', { name: other.firstName() }));
  else if (result.reason === 'unavailable') return res.status(403).render('error', { title: req.t('messages.title'), message: req.t('messages.unavailable') });
  res.redirect('/messages/' + other.id);
});

router.post('/messages/:seniorId/exchange/:answer', requireVerified, requireContactVerified, async (req, res) => {
  const other = await loadOtherSenior(req, res);
  if (!other) return;
  const accept = req.params.answer === 'accept';
  const result = await exchange.respond(req.user, other, accept);
  if (result.ok) req.flash('success', req.t(accept ? 'exchange.you_accepted' : 'exchange.you_declined', { name: other.firstName() }));
  res.redirect('/messages/' + other.id);
});

// ---------- notifications ----------
router.get('/notifications', requireAuth, async (req, res) => {
  const notifications = await Notification.findAll({
    where: { userId: req.user.id, type: { [Op.notIn]: social.MESSAGE_NOTIFICATION_TYPES } },
    order: [['createdAt', 'DESC']],
    limit: 50
  });
  // anything to do with a conversation is shown under Messages, not here; opening the page counts as reading the rest
  await Notification.update(
    { readAt: new Date() },
    { where: { userId: req.user.id, readAt: null, type: { [Op.notIn]: social.MESSAGE_NOTIFICATION_TYPES } } }
  );
  res.render('social/notifications', { title: req.t('notifications.title'), notifications });
});

module.exports = router;
