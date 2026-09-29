const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('PasswordReset', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: DataTypes.DATE
  }, { updatedAt: false });
};
