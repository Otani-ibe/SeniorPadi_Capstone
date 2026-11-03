// Rules for who can see and message who.
const { Op } = require('sequelize');
const { User, Skip, Block, ReportHide, Notification, Message } = require('../models');

// people already in a conversation with this senior (either wrote), they are in Messages, not Find Seniors
async function messagedIds(userId) {
  const rows = await Message.findAll({
    where: { [Op.or]: [{ senderId: userId }, { recipientId: userId }] },
    attributes: ['senderId', 'recipientId'],
    group: ['senderId', 'recipientId']
  });
  return new Set(rows.map((m) => (m.senderId === userId ? m.recipientId : m.senderId)));
}

// ids this senior should never see in Find Seniors
async function hiddenIdsFor(userId) {
  // four lookups in parallel, the database may be far away
  const [skips, blocks, hides, messaged] = await Promise.all([
    Skip.findAll({ where: { seniorId: userId }, attributes: ['skippedId'] }),
    Block.findAll({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] } }),
    ReportHide.findAll({ where: { reporterId: userId }, attributes: ['reportedId'] }),
    messagedIds(userId)
  ]);

  const ids = new Set([userId]);
  skips.forEach((s) => ids.add(s.skippedId));
  blocks.forEach((b) => ids.add(b.blockerId === userId ? b.blockedId : b.blockerId));
  hides.forEach((h) => ids.add(h.reportedId));
  messaged.forEach((id) => ids.add(id));
  return Array.from(ids);
}

// block or report between the two, either direction
async function isBlockedOrHidden(aId, bId) {
  const pair = [
    { a: aId, b: bId },
    { a: bId, b: aId }
  ];
  const block = await Block.findOne({
    where: { [Op.or]: pair.map((p) => ({ blockerId: p.a, blockedId: p.b })) }
  });
  if (block) return true;

  const hide = await ReportHide.findOne({
    where: { [Op.or]: pair.map((p) => ({ reporterId: p.a, reportedId: p.b })) }
  });
  return Boolean(hide);
}

// both verified, nothing between them
async function canMessage(sender, recipient) {
  if (!sender || !recipient) return false;
  if (sender.id === recipient.id) return false;
  if (sender.verificationStatus !== 'approved' || recipient.verificationStatus !== 'approved') return false;
  if (!sender.contactVerified()) return false;
  if (recipient.role !== 'senior') return false;
  return !(await isBlockedOrHidden(sender.id, recipient.id));
}

// next verified senior for Find Seniors, or null
async function nextSeniorFor(user) {
  return (await upcomingSeniorsFor(user, 1))[0] || null;
}

// next few verified seniors, in order
async function upcomingSeniorsFor(user, limit = 3) {
  const hidden = await hiddenIdsFor(user.id);
  return User.findAll({
    where: {
      role: 'senior',
      verificationStatus: 'approved',
      id: { [Op.notIn]: hidden }
    },
    order: [['createdAt', 'ASC']],
    limit
  });
}

// seniors this senior skipped, most recent first. Leaves out blocked or reported (either way) and anyone who can no longer use Find Seniors
async function skippedSeniorsFor(user) {
  const skips = await Skip.findAll({ where: { seniorId: user.id }, order: [['createdAt', 'DESC']] });
  if (skips.length === 0) return [];

  const [people, blocks, hides, messaged] = await Promise.all([
    User.findAll({ where: { id: skips.map((s) => s.skippedId), role: 'senior', verificationStatus: 'approved' } }),
    Block.findAll({ where: { [Op.or]: [{ blockerId: user.id }, { blockedId: user.id }] } }),
    ReportHide.findAll({ where: { [Op.or]: [{ reporterId: user.id }, { reportedId: user.id }] } }),
    messagedIds(user.id)
  ]);
  const out = new Set();
  blocks.forEach((x) => out.add(x.blockerId === user.id ? x.blockedId : x.blockerId));
  hides.forEach((x) => out.add(x.reporterId === user.id ? x.reportedId : x.reporterId));

  const byId = new Map(people.map((p) => [p.id, p]));
  const result = [];
  for (const skip of skips) {
    const person = byId.get(skip.skippedId);
    if (person && !messaged.has(person.id) && !out.has(person.id)) result.push(person);
  }
  return result;
}

async function addNotification(userId, type, payload = {}, link = null) {
  return Notification.create({ userId, type, payload, link });
}

async function notifyAdmins(type, payload, link) {
  const admins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
  for (const admin of admins) await addNotification(admin.id, type, payload, link);
}

// everything about a conversation lives in Messages, not Account notifications: new message, missed call (stored as a message),
// swap-number request and its answer. Each links to /messages/<person>
const MESSAGE_NOTIFICATION_TYPES = ['message.new', 'exchange.request', 'exchange.accepted', 'exchange.declined', 'call.missed', 'call.unanswered'];

// the person a message notification is about
function personOfNotification(n) {
  if (n.payload && n.payload.senderId) return Number(n.payload.senderId);
  const match = String(n.link || '').match(/^\/messages\/(\d+)/);
  return match ? Number(match[1]) : null;
}

// what is waiting in Messages per person
// Map(personId -> { messages: 3, swapRequest: true, swapAccepted: false, swapDeclined: false })
async function unreadAlerts(userId) {
  const rows = await Notification.findAll({ where: { userId, type: MESSAGE_NOTIFICATION_TYPES, readAt: null }, attributes: ['type', 'payload', 'link'] });
  const alerts = new Map();
  for (const row of rows) {
    const person = personOfNotification(row);
    if (!person) continue;
    const entry = alerts.get(person) || { messages: 0, swapRequest: false, swapAccepted: false, swapDeclined: false };
    if (row.type === 'exchange.request') entry.swapRequest = true;
    else if (row.type === 'exchange.accepted') entry.swapAccepted = true;
    else if (row.type === 'exchange.declined') entry.swapDeclined = true;
    else entry.messages++;
    alerts.set(person, entry);
  }
  return alerts;
}

// ids with something waiting in Messages, one per person. This is the Messages tab count, drops as conversations are opened
async function unreadSenderIds(userId) {
  return new Set((await unreadAlerts(userId)).keys());
}

// opening a conversation reads everything in it: messages, missed calls, swap notices
function markConversationRead(userId, otherId) {
  return Notification.update(
    { readAt: new Date() },
    { where: { userId, type: MESSAGE_NOTIFICATION_TYPES, readAt: null, link: '/messages/' + otherId } }
  );
}

module.exports = { MESSAGE_NOTIFICATION_TYPES, unreadAlerts, markConversationRead, upcomingSeniorsFor, unreadSenderIds, hiddenIdsFor, isBlockedOrHidden, canMessage, nextSeniorFor, skippedSeniorsFor, addNotification, notifyAdmins };
