const { DataTypes } = require('sequelize');

// one row per person who came. Made when staff tick the list, scan a QR code or type a ticket number,
// or when the host organization ticks them on its link ('host')
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
