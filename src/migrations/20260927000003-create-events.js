'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Events', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      imageUrl: Sequelize.STRING,
      imagePublicId: Sequelize.STRING,
      startsAt: { type: Sequelize.DATE, allowNull: false },
      endsAt: { type: Sequelize.DATE, allowNull: false },
      locationText: { type: Sequelize.STRING, allowNull: false },
      locationMapsUrl: Sequelize.STRING,
      category: {
        type: Sequelize.ENUM('fitness', 'faith', 'learning', 'skills', 'social', 'health'),
        allowNull: false
      },
      organizationId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' }
      },
      capacity: { type: Sequelize.INTEGER, allowNull: false },
      volunteerEnabled: { type: Sequelize.BOOLEAN, defaultValue: false },
      volunteerCapacity: Sequelize.INTEGER,
      hostedBySenior: { type: Sequelize.BOOLEAN, defaultValue: false },
      registrationDeadline: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('published', 'cancelled', 'completed'),
        defaultValue: 'published'
      },
      createdByAdminId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('Events', ['startsAt', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Events');
  }
};
