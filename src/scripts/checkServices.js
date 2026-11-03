// Checks that Cloudinary (pictures) and Brevo (texts and emails) are set up and working. Prints what is wrong in plain words.
// It never prints a key.
//
//   npm run services:check                                  look at the settings and ask each service if the keys work
//   npm run services:check -- --sms 08012345678             ...and send a real test text to that number
//   npm run services:check -- --email you@example.com       ...and send a real test email to that address
//
// Test messages are sent for real, even when NOTIFY_DRY_RUN=true (that setting only affects what the app itself sends).
require('dotenv').config({ quiet: true });

const ok = (text) => console.log('  OK      ' + text);
const bad = (text) => console.log('  PROBLEM ' + text);
const note = (text) => console.log('          ' + text);
const argument = (name) => { const at = process.argv.indexOf('--' + name); return at > -1 ? process.argv[at + 1] : null; };

async function brevo(path, options = {}) {
  const res = await fetch('https://api.brevo.com/v3' + path, {
    ...options,
    headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000)
  });
  let body = null;
  try { body = await res.json(); } catch (err) { /* no body */ }
  return { status: res.status, body };
}

async function checkCloudinary() {
  console.log('\nCloudinary (pictures: profile photos, event flyers)');
  const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    bad('not set up: missing ' + missing.join(', ') + '. Until then, uploads are saved on this computer only (and disappear on Render).');
    return;
  }
  const { v2: cloudinary } = require('cloudinary');
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
  try {
    await cloudinary.api.ping();
    ok('the keys work (cloud name "' + process.env.CLOUDINARY_CLOUD_NAME + '")');
  } catch (err) {
    const detail = (err && (err.message || (err.error && err.error.message))) || 'no answer';
    bad('Cloudinary refused the keys: ' + detail + '. Check the cloud name, API key and API secret on the Cloudinary dashboard.');
  }
}

async function checkBrevo() {
  console.log('\nBrevo (texts and emails: login codes, reminders, confirmations)');
  if (process.env.NOTIFY_DRY_RUN === 'true') {
    bad('NOTIFY_DRY_RUN=true: the app only PRINTS messages in the terminal and sends nothing. Remove it (or set it to false) to send for real.');
  } else ok('NOTIFY_DRY_RUN is off, so the app sends for real');

  if (!process.env.BREVO_API_KEY) {
    bad('BREVO_API_KEY is not set. Without it nothing is sent, and the login codes never reach anyone.');
    return false;
  }
  let account;
  try {
    account = await brevo('/account');
  } catch (err) {
    bad('could not reach Brevo (' + err.message + ')');
    return false;
  }
  if (account.status === 401) { bad('Brevo refused the API key. Make a new one under SMTP & API > API Keys, and copy all of it.'); return false; }
  const canReadAccount = account.status === 200;
  if (account.status === 403) note('(this key is not allowed to read account details. Sending still works. Give it "Account: Read" if you want credits and senders checked here.)');
  else if (!canReadAccount) { bad('Brevo answered with an error (' + account.status + ').'); return false; }
  ok('the API key is accepted');

  const sms = canReadAccount ? ((account.body && account.body.plan) || []).find((p) => p.type === 'sms') : { credits: 1, unknown: true };
  if (sms && sms.unknown) note('(SMS credits not checked)');
  else if (!sms) bad('this Brevo account has no SMS credits plan yet. Buy SMS credits in Brevo (SMS > Buy credits), or no text can be sent.');
  else if (!(sms.credits > 0)) bad('SMS credits are 0. Buy more in Brevo, or texts (and so login codes) will fail.');
  else ok(Math.floor(sms.credits) + ' SMS credits left');

  const sender = (process.env.BREVO_SENDER_EMAIL || '').trim().toLowerCase();
  if (!sender) bad('BREVO_SENDER_EMAIL is not set.');
  else {
    const senders = await brevo('/senders');
    const found = senders.status === 200 && (senders.body.senders || []).find((s) => (s.email || '').toLowerCase() === sender);
    if (senders.status === 403) note('(the sender email ' + sender + ' was not checked: this key may not read senders. The test email below will show whether it works.)');
    else if (!found) bad('the sender email ' + sender + ' is not added in Brevo (Senders, Domains & Dedicated IPs > Senders). Add it and click the link Brevo emails to it.');
    else if (found.active === false) bad('the sender email ' + sender + ' is added but not confirmed yet. Open the email Brevo sent to it and confirm.');
    else ok('the sender email ' + sender + ' is confirmed');
  }

  const name = process.env.BREVO_SMS_SENDER || 'SeniorPadi';
  if (!/^[A-Za-z0-9]{1,11}$/.test(name)) bad('BREVO_SMS_SENDER "' + name + '" must be letters and numbers only, 11 characters at most.');
  else ok('the text sender name is "' + name + '"');
  return true;
}

async function sendTests() {
  const phone = argument('sms');
  const email = argument('email');
  if (!phone && !email) return;
  console.log('\nTest messages');
  if (phone) {
    const digits = String(phone).replace(/\D/g, '').replace(/^0/, '234');
    const res = await brevo('/transactionalSMS/sms', {
      method: 'POST',
      body: JSON.stringify({ sender: process.env.BREVO_SMS_SENDER || 'SeniorPadi', recipient: digits, content: 'SeniorPadi: this is a test text. If you can read it, texts are working.', type: 'transactional' })
    });
    if (res.status >= 200 && res.status < 300) ok('test text sent to +' + digits + '. It can take a minute. If it never arrives, the sender name may need registering for Nigerian networks: ask Brevo support.');
    else bad('the test text failed (' + res.status + '): ' + ((res.body && res.body.message) || 'no details'));
  }
  if (email) {
    const res = await brevo('/smtp/email', {
      method: 'POST',
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || 'SeniorPadi', email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email }], subject: 'SeniorPadi test email', htmlContent: '<p>This is a test email from SeniorPadi. If you can read it, emails are working. Check that it did not land in spam.</p>'
      })
    });
    if (res.status >= 200 && res.status < 300) ok('test email sent to ' + email + '. Check the inbox and the spam folder.');
    else bad('the test email failed (' + res.status + '): ' + ((res.body && res.body.message) || 'no details'));
  }
}

(async () => {
  await checkCloudinary();
  const brevoWorks = await checkBrevo();
  if (brevoWorks) await sendTests();
  else if (argument('sms') || argument('email')) note('(test messages skipped until Brevo is set up)');
  console.log('');
})().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; });
