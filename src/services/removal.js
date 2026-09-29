// The two ways a senior can be removed. They must not behave the same way.
const { Op } = require('sequelize');
const { Event, Registration } = require('../models');
const { notify } = require('./notify');
const { audit } = require('./audit');
const { notifyAdmins } = require('./social');
const { DAY_MS } = require('./dates');

// Admin removes a senior from the social layer.
// Event access and registrations are not touched.
async function removeFromSocial(senior, adminId) {
  await senior.update({ verificationStatus: 'social_removed' });
  await audit(adminId, 'senior.remove_from_social', 'User', senior.id);
  notify(senior, 'account.social_removed', { name: senior.firstName() }, ['sms']);
}

// Senior (or admin) deletes the account.
// Upcoming places are freed, past registrations and attendance stay.
async function deleteAccount(senior, actorId) {
  const now = new Date();

  const upcoming = await Registration.findAll({
    where: { seniorId: senior.id, status: 'registered' },
    include: [{ model: Event, where: { endsAt: { [Op.gt]: now } } }]
  });

  for (const reg of upcoming) {
    await reg.update({ status: 'cancelled' });

    // let staff know if a spot opened up on an event that's very close
    const startsSoon = new Date(reg.Event.startsAt) - now < 2 * DAY_MS;
    if (startsSoon) {
      await notifyAdmins('admin.spot_opened', { event: reg.Event.title }, '/admin/events/' + reg.Event.id + '/attendance');
    }
  }

  // send the goodbye text before the account disappears
  notify(senior, 'account.deleted', { name: senior.firstName() }, ['sms']);

  await senior.destroy(); // soft delete (paranoid), the row stays
  await audit(actorId, 'senior.delete_account', 'User', senior.id, { cancelled: upcoming.length });
  return upcoming.length;
}

module.exports = { removeFromSocial, deleteAccount };
