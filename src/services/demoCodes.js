// Showing the login code on the page, for a live presentation when texts cannot be sent (no phone network, no SMS credit).
// It is OFF unless you turn it on. Settings (.env locally, or Render's Environment page):
//
//   DEMO_SHOW_CODES=true                      the switch
//   DEMO_SHOW_CODES_UNTIL=2026-11-10 18:00    when it switches itself off (a time with no zone is Lagos time; or use
//                                             2026-11-10T18:00:00+02:00). REQUIRED on the live site.
//   DEMO_ACCOUNTS=08030000001,08030000002     optional: only these accounts show their code (empty = any senior)
//
// Safeguards: on Render (production) it does nothing without a valid end time in the future; staff accounts never show a
// code; it only ever shows a code the app just made, for ten minutes, to the person on that page. The login flow itself
// is exactly the same: the code must still be typed in.
const { normalizePhone } = require('./phone');

const isProduction = () => process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

// the end time as a Date; null when none is set; undefined when it is set but unreadable
function endTime() {
  const raw = (process.env.DEMO_SHOW_CODES_UNTIL || '').trim();
  if (!raw) return null;
  // only an unambiguous year-month-day form is accepted: "10/11/2026" could be two different days, so it is refused
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.test(raw)) return undefined;
  let text = raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) text += '+01:00'; // no zone given: Lagos time
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// { on: true|false, until: Date|null, reason } (reason says why it is off)
function status(now = new Date()) {
  if (process.env.DEMO_SHOW_CODES !== 'true') return { on: false, until: null, reason: 'the switch is off' };
  const until = endTime();
  if (until === undefined) return { on: false, until: null, reason: 'DEMO_SHOW_CODES_UNTIL cannot be read' };
  if (until && until <= now) return { on: false, until, reason: 'the end time has passed' };
  if (isProduction() && !until) return { on: false, until: null, reason: 'the live site needs DEMO_SHOW_CODES_UNTIL' };
  return { on: true, until, reason: null };
}

function listedAccounts() {
  return (process.env.DEMO_ACCOUNTS || '').split(',').map((n) => normalizePhone(n.trim())).filter(Boolean);
}

// may this person's code be shown on the page? (never staff)
function allowedFor(user, now = new Date()) {
  if (!user || user.role === 'admin' || user.isSuperAdmin) return false;
  if (!status(now).on) return false;
  const only = listedAccounts();
  return only.length === 0 || only.includes(user.phone);
}

// a line for the terminal and the admin warnings, or null when it is off
function warning(now = new Date()) {
  const s = status(now);
  if (!s.on) return process.env.DEMO_SHOW_CODES === 'true' ? 'Codes are NOT shown on screen: ' + s.reason + '.' : null;
  const only = listedAccounts();
  return 'Login codes are being shown on the screen' + (s.until ? ' until ' + s.until.toISOString() : ' (no end time: local use only)')
    + (only.length ? ', for ' + only.length + ' listed account(s)' : ', for any senior account')
    + '. Anyone who knows a phone number can log in as that person. Turn off DEMO_SHOW_CODES when the presentation is over.';
}

module.exports = { status, allowedFor, warning, listedAccounts };
