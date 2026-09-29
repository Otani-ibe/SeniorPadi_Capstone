const { DataTypes } = require('sequelize');

// a senior skipped someone in Find Seniors. They don't show up again.
module.exports = (sequelize) => {
  return sequelize.define('Skip', {
    seniorId: { type: DataTypes.INTEGER, allowNull: false },
    skippedId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    updatedAt: false,
    indexes: [{ unique: true, fields: ['seniorId', 'skippedId'] }]
  });
};
