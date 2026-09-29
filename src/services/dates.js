// All dates are stored in UTC and shown in Lagos time (UTC+1, no daylight saving)
const TIME_ZONE = 'Africa/Lagos';
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(date, lang) {
  return new Intl.DateTimeFormat(lang === 'yo' ? 'yo-NG' : 'en-NG', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(date));
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(date));
}

// short date for SMS, e.g. "Tue 29 Sep". Same in both languages to keep texts short.
function shortDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }).format(new Date(date)).replace(',', '');
}

// "2026-10-03" for a date, in Lagos time
function lagosDayString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(date));
}

// value from <input type="datetime-local"> is Lagos time without a zone
function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value + ':00+01:00');
  return isNaN(date) ? null : date;
}

// Date -> "2026-10-03T10:00" in Lagos time, for filling datetime-local inputs
function toLocalInput(date) {
  if (!date) return '';
  const lagos = new Date(new Date(date).getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 16);
}

module.exports = { TIME_ZONE, DAY_MS, formatDate, shortDate, formatTime, lagosDayString, fromLocalInput, toLocalInput };
