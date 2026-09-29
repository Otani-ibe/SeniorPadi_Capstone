// Rules for who can see and message who.
const { Op } = require('sequelize');
const { User, Skip, Block, ReportHide, Notification } = require('../models');

// ids this senior should never see in Find Seniors
async function hiddenIdsFor(userId) {
  const skips = await Skip.findAll({ where: { seniorId: userId }, attributes: ['skippedId'] });
  const blocks = await Block.findAll({
    where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] }
  });
  const hides = await ReportHide.findAll({ where: { reporterId: userId }, attributes: ['reportedId'] });

  const ids = new Set([userId]);
  skips.forEach((s) => ids.add(s.skippedId));
  blocks.forEach((b) => ids.add(b.blockerId === userId ? b.blockedId : b.blockerId));
  hides.forEach((h) => ids.add(h.reportedId));
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
  if (recipient.role !== 'senior') return false;
  return !(await isBlockedOrHidden(sender.id, recipient.id));
}

// the next verified senior to show in Find Seniors, or null
async function nextSeniorFor(user) {
  const hidden = await hiddenIdsFor(user.id);
  return User.findOne({
    where: {
      role: 'senior',
      verificationStatus: 'approved',
      id: { [Op.notIn]: hidden }
    },
    order: [['createdAt', 'ASC']]
  });
}

async function addNotification(userId, type, payload = {}, link = null) {
  return Notification.create({ userId, type, payload, link });
}

async function notifyAdmins(type, payload, link) {
  const admins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
  for (const admin of admins) await addNotification(admin.id, type, payload, link);
}

module.exports = { hiddenIdsFor, isBlockedOrHidden, canMessage, nextSeniorFor, addNotification, notifyAdmins };
