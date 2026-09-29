const { DataTypes } = require('sequelize');

// after a report, the reported senior is hidden from the reporter
// and messages between them stop. It stays even if the report is dismissed.
module.exports = (sequelize) => {
  return sequelize.define('ReportHide', {
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    reportedId: { type: DataTypes.INTEGER, allowNull: false },
    reportId: DataTypes.INTEGER
  }, {
    updatedAt: false,
    indexes: [{ unique: true, fields: ['reporterId', 'reportedId'] }]
  });
};
