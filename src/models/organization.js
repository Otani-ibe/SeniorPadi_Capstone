const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Organization', {
    name: { type: DataTypes.STRING, allowNull: false },
    contactName: DataTypes.STRING,
    contactPhone: DataTypes.STRING,
    contactEmail: DataTypes.STRING,
    address: DataTypes.STRING,
    lga: DataTypes.STRING(40), // local government area, one of Event.AREAS
    createdByAdminId: DataTypes.INTEGER
  });
};
