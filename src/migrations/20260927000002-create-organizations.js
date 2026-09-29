'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Organizations', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      contactName: Sequelize.STRING,
      contactPhone: Sequelize.STRING,
      contactEmail: Sequelize.STRING,
      createdByAdminId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Organizations');
  }
};
