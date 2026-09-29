'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Registrations', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      eventId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Events', key: 'id' }
      },
      seniorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
      },
      type: { type: Sequelize.ENUM('attendee', 'volunteer'), allowNull: false },
      status: {
        type: Sequelize.ENUM('registered', 'cancelled', 'attended', 'no_show'),
        defaultValue: 'registered'
      },
      reminderSentAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('Registrations', ['eventId', 'seniorId', 'type'], { unique: true });
    await queryInterface.addIndex('Registrations', ['eventId', 'type', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Registrations');
  }
};
