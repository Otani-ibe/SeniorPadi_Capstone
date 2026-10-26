// Confirms a senior's phone number (SMS code) and email (email code)
// before they can join an event or message another senior.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { VerificationCode } = require('../models');
const { sendSms, sendEmail } = require('./notify');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const WAIT_SECONDS = process.env.NODE_ENV === 'test' ? 0 : 60; // between "send me a code" taps
const lastCodes = {}; // test runs only: the newest plain code for each user

function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// sends a new 6-digit code. Returns { ok } or { ok: false, reason: 'wait' | 'no_email' }
async function sendCode(user, channel) {
  if (channel === 'email' && !user.email) return { ok: false, reason: 'no_email' };

  const recent = await VerificationCode.findOne({
    where: { userId: user.id, channel, createdAt: { [Op.gt]: new Date(Date.now() - WAIT_SECONDS * 1000) } }
  });
  if (recent) return { ok: false, reason: 'wait' };

  const code = String(crypto.randomInt(100000, 1000000));
  await VerificationCode.create({
    userId: user.id,
    channel,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000)
  });

  const vars = { name: user.firstName(), code, minutes: CODE_MINUTES };
  if (channel === 'phone') await sendSms(user, 'verify.code', vars);
  else await sendEmail(user, 'verify.code', vars);
  // the automated tests need the code; it's never returned anywhere else
  if (process.env.NODE_ENV === 'test') lastCodes[user.id] = code;
  return process.env.NODE_ENV === 'test' ? { ok: true, code } : { ok: true };
}

// checks a code. Returns { ok } or { ok: false, reason: 'wrong' | 'expired' | 'too_many' }
async function checkCode(user, channel, code) {
  const latest = await VerificationCode.findOne({
    where: { userId: user.id, channel, usedAt: null },
    order: [['createdAt', 'DESC']]
  });
  if (!latest || latest.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (latest.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many' };

  if (latest.codeHash !== hash(String(code || '').trim())) {
    await latest.update({ attempts: latest.attempts + 1 });
    return { ok: false, reason: 'wrong' };
  }

  await latest.update({ usedAt: new Date() });
  await user.update(channel === 'phone' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() });
  return { ok: true };
}

function lastCodeForTests(userId) {
  return process.env.NODE_ENV === 'test' ? lastCodes[userId] : undefined;
}

module.exports = { sendCode, checkCode, CODE_MINUTES, lastCodeForTests };
