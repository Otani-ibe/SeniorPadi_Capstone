// Recording who came to an event. Every way of checking in
// (ticking the list, scanning the QR code, typing the ticket number, the host organization's link)
// ends up here, so they all update the same records.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Attendance, Registration, User } = require('../models');

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACE_STATUSES = ['registered', 'attended', 'no_show']; // cancelled places are left off the list

async function markAttended(registration, method, adminId) {
  return sequelize.transaction(async (transaction) => {
    await registration.update({ status: 'attended' }, { transaction });
    const [row, created] = await Attendance.findOrCreate({
      where: { registrationId: registration.id },
      defaults: {
        eventId: registration.eventId,
        seniorId: registration.seniorId,
        method,
        checkedInAt: new Date(),
        markedByAdminId: adminId || null
      },
      transaction
    });
    return { row, created };
  });
}

// "didn't come" or "not marked": remove the attendance row
async function markNotAttended(registration, status) {
  return sequelize.transaction(async (transaction) => {
    await registration.update({ status }, { transaction });
    await Attendance.destroy({ where: { registrationId: registration.id }, transaction });
  });
}

// everyone with a place at the event, attendees first, by name
function attendanceList(eventId) {
  return Registration.findAll({
    where: { eventId, status: { [Op.in]: PLACE_STATUSES } },
    include: [{ model: User, as: 'senior', paranoid: false }, Attendance],
    order: [['type', 'ASC'], [{ model: User, as: 'senior' }, 'fullName', 'ASC']]
  });
}

async function attendanceCounts(eventId) {
  const count = (status) => Registration.count({ where: { eventId, status } });
  const came = await count('attended');
  const missed = await count('no_show');
  const waiting = await count('registered');
  return { came, missed, waiting, total: came + missed + waiting };
}

// one person: Came, Didn't come, or back to Not marked. Returns the registration, or null if it isn't on this event's list.
async function setStatus(eventId, registrationId, status, method, adminId) {
  const reg = await Registration.findOne({ where: { id: registrationId, eventId, status: { [Op.in]: PLACE_STATUSES } } });
  if (!reg) return null;
  if (PLACE_STATUSES.includes(status) && status !== reg.status) {
    if (status === 'attended') await markAttended(reg, method, adminId);
    else await markNotAttended(reg, status);
  }
  return Registration.findByPk(reg.id, { include: [{ model: User, as: 'senior', paranoid: false }, Attendance] });
}

// typed-in ticket number ("SP-7K3QX9", "7k3qx9"). Returns { reg } or { error }
async function checkInByTicket(eventId, typed, method, adminId) {
  const ticket = String(typed || '').trim().toUpperCase().replace(/\s/g, '');
  const reg = await Registration.findOne({
    where: { eventId, ticketNumber: ticket.startsWith('SP-') ? ticket : 'SP-' + ticket },
    include: [{ model: User, as: 'senior', paranoid: false }]
  });
  if (!reg) return { error: 'No ticket ' + (ticket || '(empty)') + ' for this event. Check the number, or find them by name.' };
  if (reg.status === 'cancelled') return { error: reg.ticketNumber + ' was cancelled. If they are here, welcome them and tick them on the list.' };
  await markAttended(reg, method, adminId);
  return { reg };
}

// after the event: everyone still not marked didn't come. Returns how many.
async function markRestMissed(eventId) {
  const waiting = await Registration.findAll({ where: { eventId, status: 'registered' } });
  for (const reg of waiting) await markNotAttended(reg, 'no_show');
  return waiting.length;
}

// ---------- the host organization's check-in link ----------

const newCheckinToken = () => crypto.randomBytes(24).toString('base64url');

// the link works from the day before the event until 3 days after it ends
function checkinWindow(event) {
  return {
    opens: new Date(new Date(event.startsAt).getTime() - DAY_MS),
    closes: new Date(new Date(event.endsAt).getTime() + 3 * DAY_MS)
  };
}

// 'early', 'open' or 'closed'
function checkinLinkState(event, now = new Date()) {
  const { opens, closes } = checkinWindow(event);
  if (now < opens) return 'early';
  if (now > closes) return 'closed';
  return 'open';
}

module.exports = {
  markAttended, markNotAttended, attendanceList, attendanceCounts, setStatus, checkInByTicket, markRestMissed,
  newCheckinToken, checkinWindow, checkinLinkState
};
