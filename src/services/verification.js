// Confirms a senior's phone (SMS code) and email (email code) before they can join an event or message
const crypto = require('crypto');
const { Op } = require('sequelize');
const { VerificationCode } = require('../models');
const { sendSms, sendEmail } = require('./notify');
const demo = require('./demoCodes');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const WAIT_SECONDS = process.env.NODE_ENV === 'test' ? 0 : 60; // between code requests
const lastCodes = {}; // tests only: newest plain code per user
const shownCodes = new Map(); // presentations only (demoCodes.js): 'userId:channel' -> { code, at }

function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// sends a new 6-digit code -> { ok } | { ok: false, reason: 'wait' | 'no_email' }
// options.smsKey / options.vars give different wording (the parent's text names the child)
async function sendCode(user, channel, options = {}) {
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

  const vars = { name: user.firstName(), code, minutes: CODE_MINUTES, ...(options.vars || {}) };
  if (channel === 'phone') await sendSms(user, options.smsKey || 'verify.code', vars);
  else await sendEmail(user, 'verify.code', vars);
  // presentations: the page may show this code, only for an allowed account and while on
  if (demo.allowedFor(user)) shownCodes.set(user.id + ':' + channel, { code, at: Date.now() });
  // tests need the code, never returned anywhere else
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
  shownCodes.delete(user.id + ':' + channel);
  await user.update(channel === 'phone' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() });
  return { ok: true };
}

// code to show on the page, or null. Only in presentation mode, for an allowed account, for the ten minutes the code works
function demoCodeFor(user, channel = 'phone') {
  if (!demo.allowedFor(user)) return null;
  const shown = shownCodes.get(user.id + ':' + channel);
  if (!shown || Date.now() - shown.at > CODE_MINUTES * 60 * 1000) return null;
  return shown.code;
}

function lastCodeForTests(userId) {
  return process.env.NODE_ENV === 'test' ? lastCodes[userId] : undefined;
}

module.exports = { sendCode, checkCode, demoCodeFor, CODE_MINUTES, lastCodeForTests };
