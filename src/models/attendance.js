const { DataTypes } = require('sequelize');

// One row per person who actually came to an event.
// Made when staff tick the list, scan a QR code or type in a ticket number,
// or when the host organization ticks them on its check-in link ('host').
module.exports = (sequelize) => {
  return sequelize.define('Attendance', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    registrationId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    seniorId: { type: DataTypes.INTEGER, allowNull: false },
    method: { type: DataTypes.ENUM('manual', 'qr', 'ticket', 'host'), allowNull: false, defaultValue: 'manual' },
    checkedInAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    markedByAdminId: DataTypes.INTEGER
  }, {
    indexes: [{ fields: ['eventId'] }]
  });
};
