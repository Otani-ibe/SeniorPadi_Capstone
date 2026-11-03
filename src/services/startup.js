// Everything that has to happen before the app serves people. Runs on every start and skips what is already done.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const CSS_FILE = path.join(ROOT, 'public/css/main.css');

function line(text) {
  console.log('  ' + text);
}

// 1. check settings and fill safe defaults. Must run before anything else loads
function prepareEnvironment() {
  require('dotenv').config({ quiet: true, path: path.join(ROOT, '.env') });

  // tidy NODE_ENV so "Production " or "prod" still work
  const env = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  process.env.NODE_ENV = env.startsWith('prod') ? 'production' : env === 'test' ? 'test' : 'development';
  const isProduction = process.env.NODE_ENV === 'production';
  const warnings = [];

  // no way to guess the database
  const target = (process.env.DB_TARGET || '').toLowerCase();
  const urlName = target === 'local' ? 'LOCAL_DATABASE_URL' : target === 'neon' ? 'NEON_DATABASE_URL' : 'DATABASE_URL';
  if (!process.env[urlName]) {
    throw new Error(
      'The database address is missing.\n' +
      '  Add ' + urlName + ' to the settings (the .env file, or Environment on Render).\n' +
      '  It looks like: postgres://user:password@host/database'
    );
  }

  // Render gives us the public address
  if (!process.env.APP_URL && process.env.RENDER_EXTERNAL_URL) {
    process.env.APP_URL = process.env.RENDER_EXTERNAL_URL;
  }
  if (!process.env.APP_URL) {
    process.env.APP_URL = 'http://localhost:' + (process.env.PORT || 3000);
    if (isProduction) warnings.push('APP_URL is not set. Links in texts and emails will point to localhost.');
  }

  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me-to-a-long-random-string') {
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    if (isProduction) warnings.push('SESSION_SECRET is not set, so everyone is logged out whenever the app restarts.');
  }

  if (!process.env.BREVO_API_KEY) warnings.push('Brevo is not set up. Texts and emails are printed in the log instead of sent.');
  else if (process.env.NOTIFY_DRY_RUN === 'true') warnings.push('NOTIFY_DRY_RUN is on. Texts and emails are NOT being sent.');

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_SECRET) {
    warnings.push('Cloudinary is not set up. Picture, ID and video uploads are switched off.');
  }

  if (!process.env.GOOGLE_TRANSLATE_API_KEY) {
    warnings.push('Google Translate is not set up. Menus are still in Yorùbá, but event text stays in English.');
  }

  return warnings;
}

// 2. wait for the database (Neon can take a few seconds to wake)
async function waitForDatabase(sequelize, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await sequelize.authenticate();
      return;
    } catch (err) {
      const reason = (err.parent && err.parent.code) || err.name;
      if (i === attempts) {
        let hint = '';
        if (reason === 'EAI_AGAIN' || reason === 'ENOTFOUND') hint = '\n  The database address could not be found. Check the internet connection and the database URL.';
        if (reason === '28P01') hint = '\n  The database password is wrong. Copy the URL again from the database dashboard.';
        if (reason === 'ECONNREFUSED') hint = '\n  Nothing is running at that address. Is Postgres started?';
        throw new Error('Could not connect to the database (' + reason + ').' + hint);
      }
      line('Database not ready (' + reason + '), trying again in ' + i * 2 + 's...');
      await new Promise((resolve) => setTimeout(resolve, i * 2000));
    }
  }
}

// 3. the welcome guide text, if missing
async function ensureDefaultContent(models) {
  const en = require('../../locales/en.json');
  const yo = require('../../locales/yo.json');
  const texts = { en: en['onboarding.default_transcript'], yo: yo['onboarding.default_transcript'] };

  let added = 0;
  for (const language of ['en', 'yo']) {
    const [, created] = await models.OnboardingVideo.findOrCreate({
      where: { language },
      defaults: { transcript: texts[language] }
    });
    if (created) added++;
  }
  return added;
}

// 3b. the Ibadan events list, only when there are no events at all (new site). Never runs again once any event exists, never changes or removes one
async function ensureSampleEvents(models) {
  if (process.env.NODE_ENV === 'test') return 0;
  if ((await models.Event.count()) > 0) return 0;
  const { addSampleEvents } = require('./sampleEvents');
  const { ALL } = require('./sampleEvents');
  const result = await addSampleEvents(models, { include: ALL });
  return result.events;
}

// 4. the first staff account, from ADMIN_NAME / ADMIN_PHONE / ADMIN_PASSWORD
async function ensureFirstAdmin(models) {
  const adminCount = await models.User.count({ where: { role: 'admin' } });
  if (adminCount > 0) return 'exists';

  const { normalizePhone } = require('./phone');
  const bcrypt = require('bcrypt');
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  const password = process.env.ADMIN_PASSWORD;

  if (!phone || !password || password.length < 8) return 'missing';

  const existing = await models.User.findOne({ where: { phone }, paranoid: false });
  if (existing) {
    // number already belongs to someone: make them staff
    await existing.restore();
    await existing.update({ role: 'admin' });
    return 'promoted';
  }

  await models.User.create({
    fullName: process.env.ADMIN_NAME || 'SeniorPadi Admin',
    phone,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    onboardingSeenAt: new Date()
  });
  return 'created';
}

// 5. the stylesheet is in the project, rebuild it if missing
function ensureCss() {
  if (fs.existsSync(CSS_FILE)) return 'exists';
  try {
    execSync('npx @tailwindcss/cli -i ./src/styles/input.css -o ./public/css/main.css --minify', { cwd: ROOT, stdio: 'ignore' });
    return 'built';
  } catch (err) {
    return 'failed';
  }
}

module.exports = { prepareEnvironment, waitForDatabase, ensureDefaultContent, ensureSampleEvents, ensureFirstAdmin, ensureCss, line };
