const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Organization', {
    name: { type: DataTypes.STRING, allowNull: false },
    contactName: DataTypes.STRING,
    contactPhone: DataTypes.STRING,
    contactEmail: DataTypes.STRING,
    createdByAdminId: DataTypes.INTEGER
  });
};
