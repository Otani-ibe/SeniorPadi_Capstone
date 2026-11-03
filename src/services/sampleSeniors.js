// Demo seniors (src/scripts/data/seniors.js): each gets an account, verified, with a picture if there is one. They can all message each other.
// safe to rerun: only creates the listed accounts and fills blanks, never replaces a photo, bio or place someone set.
// does not run at start-up (practice accounts), use `npm run seniors:add` or `npm run seed`
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const data = require('../scripts/data/seniors');

const PHOTO_DIR = path.join(__dirname, '../../public/images/seniors');
const photoUrl = (slug) => (slug && fs.existsSync(path.join(PHOTO_DIR, slug + '.jpg')) ? '/images/seniors/' + slug + '.jpg' : null);

// models: the app's models. -> { created, updated, list: [{ name, phone, photo }] }
async function ensureSampleSeniors(models, { log = () => {} } = {}) {
  const { User } = models;
  const now = new Date();
  const result = { created: 0, updated: 0, list: [] };
  let passwordHash = null;

  for (const e of data) {
    const picture = photoUrl(e.photo);
    let user = await User.findOne({ where: { phone: e.phone }, paranoid: false });

    if (user && user.deletedAt) {
      log('  ! skipped (account was deleted): ' + e.fullName);
      continue;
    }

    if (!user) {
      passwordHash = passwordHash || (await bcrypt.hash('password123', 10));
      user = await User.create({
        fullName: e.fullName,
        phone: e.phone,
        passwordHash,
        ageDeclared: true,
        gender: e.gender,
        preferredLanguage: e.language || 'en',
        area: e.area || null,
        lga: e.lga || null,
        bio: e.bio || null,
        profilePictureUrl: picture,
        verificationStatus: 'approved',
        phoneVerifiedAt: now,
        onboardingSeenAt: now
      });
      result.created++;
      log('  + ' + e.fullName + '  ' + e.phone + (picture ? '' : '  (no picture)'));
    } else {
      // verified so they can message each other, the rest only where blank
      const changes = {};
      if (user.verificationStatus !== 'approved') changes.verificationStatus = 'approved';
      if (!user.phoneVerifiedAt) changes.phoneVerifiedAt = now;
      if (user.email && !user.emailVerifiedAt) changes.emailVerifiedAt = now;
      if (!user.onboardingSeenAt) changes.onboardingSeenAt = now;
      if (!user.gender && e.gender) changes.gender = e.gender;
      if (!user.bio && e.bio) changes.bio = e.bio;
      if (!user.area && e.area) changes.area = e.area;
      if (!user.lga && e.lga) changes.lga = e.lga;
      if (!user.profilePictureUrl && picture) changes.profilePictureUrl = picture;
      if (Object.keys(changes).length) {
        await user.update(changes);
        result.updated++;
        log('  ~ ' + e.fullName + ': ' + Object.keys(changes).join(', '));
      }
    }
    result.list.push({ name: e.fullName, phone: e.phone, local: '0' + e.phone.slice(4), gender: e.gender, photo: Boolean(user.profilePictureUrl) });
  }
  return result;
}

module.exports = { ensureSampleSeniors };
