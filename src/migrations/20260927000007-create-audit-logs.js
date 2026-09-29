'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AuditLogs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      actorId: Sequelize.INTEGER,
      action: { type: Sequelize.STRING, allowNull: false },
      entityType: Sequelize.STRING,
      entityId: Sequelize.INTEGER,
      metadata: Sequelize.JSONB,
      createdAt: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AuditLogs');
  }
};
