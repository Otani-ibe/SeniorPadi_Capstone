const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Message', {
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    // 'text' (what someone wrote) or 'missed_call' (a call that rang out: written by the system, sent by the caller)
    kind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'text' },
    readAt: DataTypes.DATE // when the recipient opened the conversation; empty = not yet
  }, {
    updatedAt: false,
    indexes: [{ fields: ['senderId', 'recipientId', 'createdAt'] }]
  });
};
