const { DataTypes } = require('sequelize');
const crypto = require('crypto');

// no 0/O or 1/I/L, so it's easy to read out over the phone
const TICKET_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeTicketNumber() {
  let code = '';
  for (let i = 0; i < 6; i++) code += TICKET_LETTERS[crypto.randomInt(TICKET_LETTERS.length)];
  return 'SP-' + code;
}

module.exports = (sequelize) => {
  const Registration = sequelize.define('Registration', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    seniorId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM('attendee', 'volunteer'), allowNull: false },
    status: {
      type: DataTypes.ENUM('registered', 'cancelled', 'attended', 'no_show'),
      defaultValue: 'registered'
    },
    reminderSentAt: DataTypes.DATE,
    // for the optional QR check-in. Never required to attend.
    qrToken: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true },
    // the "pass" for the event, e.g. SP-7K3QX9. Sent by SMS and email.
    ticketNumber: { type: DataTypes.STRING(12), allowNull: false, unique: true, defaultValue: () => makeTicketNumber() }
  }, {
    indexes: [
      { unique: true, fields: ['eventId', 'seniorId', 'type'] },
      { fields: ['eventId', 'type', 'status'] }
    ]
  });

  Registration.makeTicketNumber = makeTicketNumber;
  return Registration;
};
