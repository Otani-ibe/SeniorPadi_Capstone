const { DataTypes } = require('sequelize');

// in-app notifications (new message, ID result, and admin alerts)
module.exports = (sequelize) => {
  return sequelize.define('Notification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    payload: { type: DataTypes.JSONB, defaultValue: {} },
    link: DataTypes.STRING,
    readAt: DataTypes.DATE
  }, {
    updatedAt: false,
    indexes: [{ fields: ['userId', 'readAt'] }]
  });
};
