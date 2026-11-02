// Rules for who can see and message who.
const { Op } = require('sequelize');
const { User, Skip, Block, ReportHide, Notification, Message } = require('../models');

// people this senior already has a conversation with (either of them wrote). They are in Messages,
// so Find Seniors doesn't show them again.
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
  // the four lookups run at the same time (the database may be far away, so waiting for each one in turn is slow)
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

// true if there's a block or a report between the two, in either direction
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

// both verified, and nothing between them
async function canMessage(sender, recipient) {
  if (!sender || !recipient) return false;
  if (sender.id === recipient.id) return false;
  if (sender.verificationStatus !== 'approved' || recipient.verificationStatus !== 'approved') return false;
  if (!sender.contactVerified()) return false;
  if (recipient.role !== 'senior') return false;
  return !(await isBlockedOrHidden(sender.id, recipient.id));
}

// the next verified senior to show in Find Seniors, or null
async function nextSeniorFor(user) {
  return (await upcomingSeniorsFor(user, 1))[0] || null;
}

// the next few verified seniors to show, in order
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

// seniors this senior skipped, most recent first. Leaves out anyone blocked or reported
// (either way) and anyone who can no longer use Find Seniors.
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

// the ids of people whose messages this person hasn't opened yet (one id per person, however many messages)
async function unreadSenderIds(userId) {
  const rows = await Notification.findAll({ where: { userId, type: 'message.new', readAt: null }, attributes: ['payload'] });
  return new Set(rows.map((n) => n.payload && n.payload.senderId).filter(Boolean));
}

module.exports = { upcomingSeniorsFor, unreadSenderIds, hiddenIdsFor, isBlockedOrHidden, canMessage, nextSeniorFor, skippedSeniorsFor, addNotification, notifyAdmins };
