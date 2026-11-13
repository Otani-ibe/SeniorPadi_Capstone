// the two ways a senior is removed, they must not behave alike
const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, Event, Registration, Message, Notification, PhoneExchange, Block, Skip, EventInterest, ReportHide,
  VerificationCode, PasswordReset, IdentityVerification
} = require('../models');
const { notify, sendSms } = require('./notify');
const cloud = require('./cloudinary');
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
// Upcoming places are freed. The person is erased: name, phone, email, picture, bio, address, NIN and the messages they wrote
// are removed for good (right to erasure, Nigeria Data Protection Act 2023, s. 34). Only an empty row stays, shown as
// "Deleted member", so past registrations, attendance counts, reports and the audit trail still add up.
async function deleteAccount(senior, actorId) {
  const now = new Date();

  const upcoming = await Registration.findAll({
    where: { seniorId: senior.id, status: 'registered' },
    include: [{ model: Event, where: { endsAt: { [Op.gt]: now } } }]
  });

  for (const reg of upcoming) {
    await reg.update({ status: 'cancelled' });

    // tell staff if a spot opened on an event that's close
    const startsSoon = new Date(reg.Event.startsAt) - now < 2 * DAY_MS;
    if (startsSoon) {
      await notifyAdmins('admin.spot_opened', { event: reg.Event.title }, '/admin/events/' + reg.Event.id + '/attendance');
    }
  }

  // goodbye text first, to the number that is about to be erased. Waited for, so it cannot go to the blank one
  const goodbye = { phone: senior.phone, preferredLanguage: senior.preferredLanguage };
  await sendSms(goodbye, 'account.deleted', { name: senior.firstName() }).catch(() => {});

  const id = senior.id;
  const pictureId = senior.profilePicturePublicId;

  await sequelize.transaction(async (transaction) => {
    const remove = (Model, where) => Model.destroy({ where, transaction, force: true });

    await remove(Message, { senderId: id }); // what they wrote. What others wrote to them belongs to those people
    await remove(Notification, { userId: id });
    await remove(VerificationCode, { userId: id });
    await remove(PasswordReset, { userId: id });
    await remove(IdentityVerification, { userId: id }); // a NIN still waiting, and the hash of a verified one
    await remove(EventInterest, { seniorId: id });
    await remove(PhoneExchange, { [Op.or]: [{ requesterId: id }, { recipientId: id }] });
    await remove(Block, { [Op.or]: [{ blockerId: id }, { blockedId: id }] });
    await remove(Skip, { [Op.or]: [{ seniorId: id }, { skippedId: id }] });
    await remove(ReportHide, { reporterId: id });

    // the row stays but holds nothing about the person. The phone column must be filled and unique, so it gets a marker
    // that is not a number. The real number is free again, so they can sign up again
    await senior.update({
      fullName: 'Deleted member',
      phone: 'erased-' + id + '-' + crypto.randomBytes(4).toString('hex'),
      email: null,
      passwordHash: crypto.randomBytes(32).toString('hex'), // not a real hash: nobody can sign in
      bio: null,
      area: null,
      lga: null,
      gender: null,
      profilePictureUrl: null,
      profilePicturePublicId: null,
      latitude: null,
      longitude: null,
      geoSource: null,
      geocodedAt: null,
      createdByName: null,
      createdByPhone: null,
      verificationRejectionReason: null,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      showOnlineStatus: false,
      remindersEnabled: false
    }, { transaction, hooks: false }); // no hooks: clearing the address must not queue a new map lookup
    await senior.destroy({ transaction }); // soft delete, so lists skip the row
  });

  if (pictureId) await cloud.deleteFile(pictureId); // a file, not a row, so outside the transaction
  await audit(actorId, 'senior.delete_account', 'User', id, { cancelled: upcoming.length });
  return upcoming.length;
}

module.exports = { removeFromSocial, deleteAccount };
