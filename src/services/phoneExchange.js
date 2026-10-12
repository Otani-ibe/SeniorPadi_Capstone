// Swapping phone numbers between two verified seniors.
// The number is only shown after the other person taps Accept.
const { Op } = require('sequelize');
const { PhoneExchange } = require('../models');
const social = require('./social');

// the request between these two people, in either direction
async function between(aId, bId) {
  return PhoneExchange.findOne({
    where: {
      [Op.or]: [
        { requesterId: aId, recipientId: bId },
        { requesterId: bId, recipientId: aId }
      ]
    },
    order: [['updatedAt', 'DESC']]
  });
}

async function request(from, to) {
  if (!(await social.canMessage(from, to))) return { ok: false, reason: 'unavailable' };

  const existing = await between(from.id, to.id);
  if (existing && existing.status === 'accepted') return { ok: false, reason: 'already' };
  if (existing && existing.status === 'pending') return { ok: false, reason: 'pending' };

  if (existing) {
    // asked again after a "no": start a fresh request from this person
    await existing.update({ requesterId: from.id, recipientId: to.id, status: 'pending', respondedAt: null });
  } else {
    await PhoneExchange.create({ requesterId: from.id, recipientId: to.id });
  }
  await social.addNotification(to.id, 'exchange.request', { name: from.firstName() }, '/messages/' + from.id);
  return { ok: true };
}

async function respond(user, other, accept) {
  const ex = await PhoneExchange.findOne({ where: { requesterId: other.id, recipientId: user.id, status: 'pending' } });
  if (!ex) return { ok: false };
  if (accept && !(await social.canMessage(user, other))) return { ok: false };

  await ex.update({ status: accept ? 'accepted' : 'declined', respondedAt: new Date() });
  await social.addNotification(other.id, accept ? 'exchange.accepted' : 'exchange.declined', { name: user.firstName() }, '/messages/' + user.id);
  return { ok: true };
}

module.exports = { between, request, respond };
