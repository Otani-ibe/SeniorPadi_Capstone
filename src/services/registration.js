// Registers a senior and sends the confirmation. Used by Register and by log in and register
const capacity = require('./capacity');
const { notify } = require('./notify');
const { shortDate, formatTime } = require('./dates');

const ERROR_KEYS = {
  full: 'register.full',
  closed: 'register.closed',
  already: 'register.already',
  not_found: 'events.not_found'
};

async function registerAndNotify(user, eventId, type) {
  const result = await capacity.register(eventId, user.id, type);
  if (!result.ok) {
    let key = ERROR_KEYS[result.reason];
    if (result.reason === 'full' && type === 'volunteer') key = 'register.volunteer_full';
    return { ok: false, errorKey: key };
  }

  const event = result.event;
  const ticket = result.registration.ticketNumber;
  notify(user, type === 'volunteer' ? 'event.volunteered' : 'event.registered', {
    name: user.firstName(),
    event: event.title,
    date: shortDate(event.startsAt),
    time: formatTime(event.startsAt),
    place: event.locationText,
    days: user.reminderDaysBefore,
    ticket
  });
  return { ok: true, event, registration: result.registration };
}

// own pages only
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

module.exports = { registerAndNotify, safeNext };
