const { DataTypes } = require('sequelize');

// 6-digit codes sent by SMS or email to confirm a phone or email. Only a hash is stored
module.exports = (sequelize) => {
  return sequelize.define('VerificationCode', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    channel: { type: DataTypes.ENUM('phone', 'email'), allowNull: false },
    codeHash: { type: DataTypes.STRING, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    usedAt: DataTypes.DATE
  }, {
    updatedAt: false,
    indexes: [{ fields: ['userId', 'channel'] }]
  });
};
