const { DataTypes } = require('sequelize');

// blocks work both ways and can't be undone
module.exports = (sequelize) => {
  return sequelize.define('Block', {
    blockerId: { type: DataTypes.INTEGER, allowNull: false },
    blockedId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    updatedAt: false,
    indexes: [{ unique: true, fields: ['blockerId', 'blockedId'] }]
  });
};
