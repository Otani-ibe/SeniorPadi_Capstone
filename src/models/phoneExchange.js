const { DataTypes } = require('sequelize');

// "Can we swap phone numbers?" between two verified seniors.
// Numbers are only shown once the other person accepts.
module.exports = (sequelize) => {
  return sequelize.define('PhoneExchange', {
    requesterId: { type: DataTypes.INTEGER, allowNull: false },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'accepted', 'declined'), defaultValue: 'pending' },
    respondedAt: DataTypes.DATE
  }, {
    indexes: [{ unique: true, fields: ['requesterId', 'recipientId'] }]
  });
};
