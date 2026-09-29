const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Report', {
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    reportedId: { type: DataTypes.INTEGER, allowNull: false },
    conversationSnapshot: { type: DataTypes.JSONB, defaultValue: [] },
    reason: DataTypes.TEXT,
    status: {
      type: DataTypes.ENUM('pending', 'warned', 'removed', 'dismissed'),
      defaultValue: 'pending'
    },
    reviewedByAdminId: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE
  }, {
    updatedAt: false,
    indexes: [{ fields: ['status'] }]
  });
};
