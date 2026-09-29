const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('AuditLog', {
    actorId: DataTypes.INTEGER,
    action: { type: DataTypes.STRING, allowNull: false },
    entityType: DataTypes.STRING,
    entityId: DataTypes.INTEGER,
    metadata: DataTypes.JSONB
  }, { updatedAt: false });
};
