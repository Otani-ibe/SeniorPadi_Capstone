'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('EventInterests', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      seniorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      category: { type: Sequelize.STRING, allowNull: false },
      sourceEventId: { type: Sequelize.INTEGER, references: { model: 'Events', key: 'id' } },
      notifiedAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('EventInterests', ['seniorId', 'category'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('EventInterests');
  }
};
