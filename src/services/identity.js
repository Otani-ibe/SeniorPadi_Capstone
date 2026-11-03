// NIN identity check, decided by a person (the superadmin). Nothing goes to an outside service.
// Stored encrypted (AES-256-GCM), erased as soon as a decision is made, never logged or shown to anyone else.
// A valid NIN counts as proof of citizenship, not checked separately.
// Needs NIN_ENCRYPTION_KEY (32+ chars), without it nothing is accepted or stored. Changing it only breaks NINs still waiting.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, IdentityVerification } = require('../models');
const notifier = require('./notify');
const { addNotification } = require('./social');
const { audit } = require('./audit');

const MAX_REJECTIONS = 3; // after this many rejections they are asked to call
const CAN_SUBMIT = ['unverified', 'rejected'];

// ---------- the NIN ----------

// "123 4567 8901" -> "12345678901", anything else -> null
function normalizeNin(raw) {
  const nin = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
  return /^\d{11}$/.test(nin) ? nin : null;
}

// ---------- encryption ----------

// separate keys for encrypting and hashing, both from the one secret
function keyFor(purpose) {
  const secret = process.env.NIN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) return null;
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'seniorpadi-nin', purpose, 32));
}

function isConfigured() {
  return keyFor('encrypt') !== null;
}

// "v1:" + base64(iv + auth tag + ciphertext). user id is the AAD so a value cannot be moved to another account, random iv each time
function encryptNin(nin, userId) {
  const key = keyFor('encrypt');
  if (!key) throw new Error('NIN_ENCRYPTION_KEY is not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('user:' + userId));
  const body = Buffer.concat([cipher.update(nin, 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

// null when unreadable (wrong key, tampered, other account)
function decryptNin(stored, userId) {
  const key = keyFor('encrypt');
  if (!key || typeof stored !== 'string' || !stored.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(stored.slice(3), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from('user:' + userId));
    decipher.setAuthTag(raw.subarray(12, 28));
    const nin = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    return normalizeNin(nin);
  } catch (err) {
    return null;
  }
}

// keyed hash so a db copy can't be brute-forced
function hashNin(nin) {
  const key = keyFor('hash');
  if (!key) throw new Error('NIN_ENCRYPTION_KEY is not set');
  return crypto.createHmac('sha256', key).update(nin).digest('hex');
}

// ---------- telling people ----------

// text lives in locales: identity.<outcome>.sms / .email / .subject, notification.identity.<outcome>
async function tell(user, outcome, vars = {}) {
  const link = outcome === 'verified' ? '/find-seniors' : '/identity/status';
  try {
    await addNotification(user.id, 'identity.' + outcome, vars, link);
  } catch (err) {
    console.error('Could not save the verification notice:', err.message);
  }
  notifier.notify(user, 'identity.' + outcome, { name: user.firstName(), ...vars });
}

// only the superadmin is told
async function tellSuperAdmins(senior) {
  try {
    const staff = await User.findAll({ where: { role: 'admin', isSuperAdmin: true }, attributes: ['id'] });
    for (const person of staff) await addNotification(person.id, 'admin.id_submitted', { name: senior.fullName }, '/admin/ids');
  } catch (err) {
    console.error('Could not tell the superadmin:', err.message);
  }
}

// ---------- the senior sends their NIN ----------

// rejections left before they have to call
async function rejectionsLeft(user) {
  return MAX_REJECTIONS - await IdentityVerification.count({ where: { userId: user.id, status: 'rejected' } });
}

// -> { ok: true } | { ok: false, reason: 'bad_format' | 'no_consent' | 'not_allowed' | 'too_many' | 'in_progress' | 'unavailable' }
async function submitNin(user, rawNin, { consent, now = new Date() } = {}) {
  const nin = normalizeNin(rawNin);
  if (!nin) return { ok: false, reason: 'bad_format' };
  if (consent !== true) return { ok: false, reason: 'no_consent' };
  if (user.role !== 'senior' || !CAN_SUBMIT.includes(user.verificationStatus)) return { ok: false, reason: 'not_allowed' };
  if ((await rejectionsLeft(user)) <= 0) return { ok: false, reason: 'too_many' };

  // key check first, nothing is saved without it
  let encryptedNin;
  let ninHash;
  try {
    encryptedNin = encryptNin(nin, user.id);
    ninHash = hashNin(nin);
  } catch (err) {
    return { ok: false, reason: 'unavailable' };
  }

  // claimed in one step so a double tap makes one submission
  const [claimed] = await User.update(
    { verificationStatus: 'pending', verificationRejectionReason: null },
    { where: { id: user.id, verificationStatus: { [Op.in]: CAN_SUBMIT } } }
  );
  if (!claimed) return { ok: false, reason: 'in_progress' };

  await IdentityVerification.create({ userId: user.id, status: 'submitted', encryptedNin, ninHash, consentAt: now, submittedAt: now });
  user.verificationStatus = 'pending';

  await audit(null, 'identity.submitted', 'User', user.id);
  await tellSuperAdmins(user);
  await tell(user, 'manual_review');
  return { ok: true };
}

// ---------- the superadmin ----------

// waiting submission or null
function waitingFor(user) {
  return IdentityVerification.findOne({ where: { userId: user.id, status: 'submitted' }, order: [['createdAt', 'DESC']] });
}

// other account already holding this NIN as verified, so the superadmin is warned
async function duplicateOf(row) {
  if (!row.ninHash) return null;
  const other = await IdentityVerification.findOne({ where: { ninHash: row.ninHash, status: 'verified', userId: { [Op.ne]: row.userId } }, attributes: ['userId'] });
  return other ? User.findByPk(other.userId, { attributes: ['id', 'fullName'] }) : null;
}

// shows the NIN to the superadmin, audited (who, whose, never the number)
// -> { ok: true, nin } | { ok: false, reason: 'not_waiting' | 'unreadable' }
async function revealNin(adminId, user) {
  const row = user.verificationStatus === 'pending' ? await waitingFor(user) : null;
  if (!row) return { ok: false, reason: 'not_waiting' };
  await audit(adminId, 'identity.nin_viewed', 'User', user.id);
  const nin = decryptNin(row.encryptedNin, user.id);
  return nin ? { ok: true, nin } : { ok: false, reason: 'unreadable' };
}

// outcome: verified | not_eligible | rejected (rejected needs a note). NIN erased in the same step
// -> { ok: true } | { ok: false, reason: 'not_waiting' | 'duplicate' | 'no_note' | 'bad_outcome' }
async function decide(adminId, user, outcome, note, now = new Date()) {
  if (!['verified', 'not_eligible', 'rejected'].includes(outcome)) return { ok: false, reason: 'bad_outcome' };
  const reason = String(note || '').trim().slice(0, 300);
  if (outcome === 'rejected' && !reason) return { ok: false, reason: 'no_note' };

  const row = user.verificationStatus === 'pending' ? await waitingFor(user) : null;
  if (!row) return { ok: false, reason: 'not_waiting' };

  try {
    await row.update({
      status: outcome,
      encryptedNin: null, // erased after the check
      ninHash: outcome === 'verified' ? row.ninHash : null, // kept only to stop one NIN verifying two accounts
      decisionNote: outcome === 'rejected' ? reason : null,
      reviewedByAdminId: adminId, reviewedAt: now, completedAt: now
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { ok: false, reason: 'duplicate' };
    throw err;
  }

  await user.update({
    verificationStatus: outcome === 'verified' ? 'approved' : outcome,
    verificationRejectionReason: outcome === 'rejected' ? reason : null
  });
  await audit(adminId, 'identity.' + outcome, 'User', user.id, outcome === 'rejected' ? { reason } : {});
  await tell(user, outcome === 'rejected' ? 'review_rejected' : outcome, outcome === 'rejected' ? { reason } : {});
  return { ok: true };
}

module.exports = {
  MAX_REJECTIONS, CAN_SUBMIT,
  normalizeNin, isConfigured, encryptNin, decryptNin, hashNin,
  submitNin, rejectionsLeft, waitingFor, duplicateOf, revealNin, decide
};
