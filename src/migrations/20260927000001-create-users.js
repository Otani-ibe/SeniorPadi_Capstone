'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Users', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      fullName: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: false, unique: true },
      email: { type: Sequelize.STRING, allowNull: true, unique: true },
      passwordHash: { type: Sequelize.STRING, allowNull: false },
      mustChangePassword: { type: Sequelize.BOOLEAN, defaultValue: false },
      ageDeclared: { type: Sequelize.BOOLEAN, defaultValue: false },
      preferredLanguage: { type: Sequelize.ENUM('en', 'yo'), defaultValue: 'en' },
      role: { type: Sequelize.ENUM('senior', 'admin'), defaultValue: 'senior' },
      verificationStatus: {
        type: Sequelize.ENUM('unverified', 'pending', 'approved', 'rejected', 'social_removed'),
        defaultValue: 'unverified'
      },
      verificationRejectionReason: Sequelize.TEXT,
      bio: Sequelize.TEXT,
      area: Sequelize.STRING,
      profilePictureUrl: Sequelize.STRING,
      profilePicturePublicId: Sequelize.STRING,
      idDocumentPublicId: Sequelize.STRING,
      idDocumentFormat: Sequelize.STRING,
      reminderDaysBefore: { type: Sequelize.INTEGER, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: Sequelize.DATE
    });
    await queryInterface.addIndex('Users', ['verificationStatus']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Users');
  }
};
