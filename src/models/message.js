const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Message', {
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    readAt: DataTypes.DATE // when the recipient opened the conversation; empty = not yet
  }, {
    updatedAt: false,
    indexes: [{ fields: ['senderId', 'recipientId', 'createdAt'] }]
  });
};
