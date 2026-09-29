// Everything to do with seats: counting, tags and registering safely.
const { Op } = require('sequelize');
const { sequelize, Event, Registration } = require('../models');
const { DAY_MS } = require('./dates');

const ALMOST_FULL_AT = 5; // show "Almost full" when 5 or fewer spots are left
const DEADLINE_WARNING_DAYS = 5; // show "Closes in X days" when 5 or fewer days are left

// cancelled and no_show registrations do not take a seat
const SEAT_STATUSES = ['registered', 'attended'];

async function countTaken(eventId, type, transaction) {
  return Registration.count({
    where: { eventId, type, status: { [Op.in]: SEAT_STATUSES } },
    transaction
  });
}

function capacityFor(event, type) {
  return type === 'volunteer' ? (event.volunteerCapacity || 0) : event.capacity;
}

// Works out which tags and buttons to show. Pure function so it's easy to test.
function eventState(event, takenAttendee, takenVolunteer, now = new Date()) {
  const attendeeLeft = event.capacity - takenAttendee;
  const volunteerLeft = (event.volunteerCapacity || 0) - takenVolunteer;

  const msToDeadline = new Date(event.registrationDeadline) - now;
  const deadlinePassed = msToDeadline <= 0;
  const daysToDeadline = Math.ceil(msToDeadline / DAY_MS);
  const isOpen = event.status === 'published' && !deadlinePassed && new Date(event.startsAt) > now;

  return {
    isOpen,
    isCancelled: event.status === 'cancelled',
    isPast: new Date(event.endsAt) < now,
    attendeeFull: attendeeLeft <= 0,
    attendeeAlmostFull: attendeeLeft > 0 && attendeeLeft <= ALMOST_FULL_AT,
    volunteerEnabled: event.volunteerEnabled,
    volunteerFull: event.volunteerEnabled && volunteerLeft <= 0,
    volunteerAlmostFull: event.volunteerEnabled && volunteerLeft > 0 && volunteerLeft <= ALMOST_FULL_AT,
    closesSoon: isOpen && daysToDeadline <= DEADLINE_WARNING_DAYS,
    daysToDeadline
  };
}

async function getEventState(event) {
  const attendee = await countTaken(event.id, 'attendee');
  const volunteer = event.volunteerEnabled ? await countTaken(event.id, 'volunteer') : 0;
  return eventState(event, attendee, volunteer);
}

// Registers a senior as attendee or volunteer.
// Locks the event row so two people can't take the last seat at the same time.
// Returns { ok: true, registration } or { ok: false, reason }
async function register(eventId, seniorId, type) {
  return sequelize.transaction(async (transaction) => {
    const event = await Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!event) return { ok: false, reason: 'not_found' };
    if (type === 'volunteer' && !event.volunteerEnabled) return { ok: false, reason: 'not_found' };

    const now = new Date();
    if (event.status !== 'published' || new Date(event.registrationDeadline) <= now || new Date(event.startsAt) <= now) {
      return { ok: false, reason: 'closed' };
    }

    const existing = await Registration.findOne({ where: { eventId, seniorId, type }, transaction });
    if (existing && SEAT_STATUSES.includes(existing.status)) {
      return { ok: false, reason: 'already' };
    }

    const taken = await countTaken(eventId, type, transaction);
    if (taken >= capacityFor(event, type)) {
      return { ok: false, reason: 'full' };
    }

    let registration;
    if (existing) {
      // they cancelled before and are coming back
      registration = await existing.update({ status: 'registered', reminderSentAt: null }, { transaction });
    } else {
      registration = await Registration.create({ eventId, seniorId, type }, { transaction });
    }
    return { ok: true, registration, event };
  });
}

module.exports = {
  ALMOST_FULL_AT,
  DEADLINE_WARNING_DAYS,
  SEAT_STATUSES,
  countTaken,
  eventState,
  getEventState,
  register
};
