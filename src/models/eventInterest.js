const { DataTypes } = require('sequelize');

// "tell me when a similar event is listed"
module.exports = (sequelize) => {
  return sequelize.define('EventInterest', {
    seniorId: { type: DataTypes.INTEGER, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    sourceEventId: DataTypes.INTEGER,
    notifiedAt: DataTypes.DATE
  }, {
    updatedAt: false,
    indexes: [{ unique: true, fields: ['seniorId', 'category'] }]
  });
};
