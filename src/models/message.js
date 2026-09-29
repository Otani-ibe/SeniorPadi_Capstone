const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Message', {
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false }
  }, {
    updatedAt: false,
    indexes: [{ fields: ['senderId', 'recipientId', 'createdAt'] }]
  });
};
