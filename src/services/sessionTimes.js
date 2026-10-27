// How long sign-ins last.
const DAY_MS = 24 * 60 * 60 * 1000;

// a senior (or staff member) stays signed in for 30 days, then signs in again with a new code
const SIGN_IN_DAYS = 30;
// a son or daughter can book events for a parent on their phone for one day, then needs a new code
const BOOKING_HOURS = 24;

function signInExpired(signedInAt, now = Date.now()) {
  return Boolean(signedInAt) && now - signedInAt > SIGN_IN_DAYS * DAY_MS;
}

function bookingActive(booking, now = Date.now()) {
  return Boolean(booking && booking.at) && now - booking.at < BOOKING_HOURS * 60 * 60 * 1000;
}

module.exports = { SIGN_IN_DAYS, BOOKING_HOURS, signInExpired, bookingActive };
