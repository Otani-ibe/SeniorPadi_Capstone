// Sends transactional email and SMS through Brevo.
// Everything goes through sendEmail / sendSms so we could swap provider later.
const path = require('path');
const ejs = require('ejs');
const { t } = require('./i18n');
const { audit } = require('./audit');

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_SMS_URL = 'https://api.brevo.com/v3/transactionalSMS/sms';
const RETRY_DELAY_MS = 30 * 1000;

function isDryRun() {
  return process.env.NOTIFY_DRY_RUN === 'true' || !process.env.BREVO_API_KEY;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST to Brevo. Retries once after 30 seconds if Brevo returns a 5xx.
async function postToBrevo(url, body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.ok) return;

    const text = await res.text();
    if (res.status >= 500 && attempt === 1) {
      await wait(RETRY_DELAY_MS);
      continue;
    }
    throw new Error('Brevo ' + res.status + ': ' + text);
  }
}

async function sendEmail(user, key, vars = {}) {
  if (!user.email) return; // email is optional, SMS still goes out

  const lang = user.preferredLanguage || 'en';
  const subject = t(key + '.subject', lang, vars);
  const body = t(key + '.email', lang, vars);
  const html = await ejs.renderFile(
    path.join(__dirname, '../../views/emails/layout.ejs'),
    { subject, paragraphs: body.split('\n'), footer: t('email.footer', lang) }
  );

  if (isDryRun()) {
    if (process.env.NODE_ENV !== 'test') console.log('[email dry run] to ' + user.email + ' | ' + subject + '\n' + body + '\n');
    return;
  }

  try {
    await postToBrevo(BREVO_EMAIL_URL, {
      sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: user.email, name: user.fullName }],
      subject,
      htmlContent: html
    });
  } catch (err) {
    console.error('Email failed:', err.message);
    await audit(null, 'notify.email_failed', 'User', user.id, { key, error: err.message });
  }
}

async function sendSms(user, key, vars = {}) {
  const lang = user.preferredLanguage || 'en';
  const content = t(key + '.sms', lang, vars);

  if (isDryRun()) {
    if (process.env.NODE_ENV !== 'test') console.log('[sms dry run] to ' + user.phone + ' | ' + content + '\n');
    return;
  }

  try {
    await postToBrevo(BREVO_SMS_URL, {
      sender: process.env.BREVO_SMS_SENDER || 'SeniorPadi',
      recipient: user.phone.replace('+', ''),
      content,
      type: 'transactional'
    });
  } catch (err) {
    console.error('SMS failed:', err.message);
    await audit(null, 'notify.sms_failed', 'User', user.id, { key, error: err.message });
  }
}

// Fire and forget: a failed message should never stop a registration
function notify(user, key, vars, channels = ['email', 'sms']) {
  if (channels.includes('email')) sendEmail(user, key, vars).catch(console.error);
  if (channels.includes('sms')) sendSms(user, key, vars).catch(console.error);
}

module.exports = { sendEmail, sendSms, notify };
