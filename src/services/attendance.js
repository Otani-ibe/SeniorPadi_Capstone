// Recording who came to an event. Every way of checking in
// (ticking the list, scanning the QR code, typing the ticket number)
// ends up here, so they all update the same records.
const { sequelize, Attendance } = require('../models');

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

module.exports = { markAttended, markNotAttended };
