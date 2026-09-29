const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Registration', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    seniorId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM('attendee', 'volunteer'), allowNull: false },
    status: {
      type: DataTypes.ENUM('registered', 'cancelled', 'attended', 'no_show'),
      defaultValue: 'registered'
    },
    reminderSentAt: DataTypes.DATE,
    // for the optional QR check-in. Never required to attend.
    qrToken: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true }
  }, {
    indexes: [
      { unique: true, fields: ['eventId', 'seniorId', 'type'] },
      { fields: ['eventId', 'type', 'status'] }
    ]
  });
};
