'use strict';

// Phase 3: onboarding video, "seen the video" flag, QR tokens for check-in
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OnboardingVideos', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      language: { type: Sequelize.ENUM('en', 'yo'), allowNull: false, unique: true },
      videoUrl: Sequelize.STRING,
      videoPublicId: Sequelize.STRING,
      transcript: { type: Sequelize.TEXT, allowNull: false },
      uploadedByAdminId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addColumn('Users', 'onboardingSeenAt', { type: Sequelize.DATE });

    // add the column, fill it for existing rows, then make it required and unique
    await queryInterface.addColumn('Registrations', 'qrToken', { type: Sequelize.UUID });
    await queryInterface.sequelize.query('UPDATE "Registrations" SET "qrToken" = gen_random_uuid() WHERE "qrToken" IS NULL');
    await queryInterface.changeColumn('Registrations', 'qrToken', { type: Sequelize.UUID, allowNull: false });
    await queryInterface.addIndex('Registrations', ['qrToken'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Registrations', 'qrToken');
    await queryInterface.removeColumn('Users', 'onboardingSeenAt');
    await queryInterface.dropTable('OnboardingVideos');
  }
};
