'use strict';

// Phase 2: tables for the social layer
module.exports = {
  async up(queryInterface, Sequelize) {
    const userRef = { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } };
    const createdAt = { type: Sequelize.DATE, allowNull: false };

    await queryInterface.createTable('Messages', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      senderId: userRef,
      recipientId: userRef,
      body: { type: Sequelize.TEXT, allowNull: false },
      createdAt
    });
    await queryInterface.addIndex('Messages', ['senderId', 'recipientId', 'createdAt']);

    await queryInterface.createTable('Skips', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      seniorId: userRef,
      skippedId: userRef,
      createdAt
    });
    await queryInterface.addIndex('Skips', ['seniorId', 'skippedId'], { unique: true });

    await queryInterface.createTable('Blocks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      blockerId: userRef,
      blockedId: userRef,
      createdAt
    });
    await queryInterface.addIndex('Blocks', ['blockerId', 'blockedId'], { unique: true });

    await queryInterface.createTable('Reports', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reporterId: userRef,
      reportedId: userRef,
      conversationSnapshot: { type: Sequelize.JSONB, defaultValue: [] },
      reason: Sequelize.TEXT,
      status: {
        type: Sequelize.ENUM('pending', 'warned', 'removed', 'dismissed'),
        defaultValue: 'pending'
      },
      reviewedByAdminId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      reviewedAt: Sequelize.DATE,
      createdAt
    });
    await queryInterface.addIndex('Reports', ['status']);

    await queryInterface.createTable('ReportHides', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reporterId: userRef,
      reportedId: userRef,
      reportId: { type: Sequelize.INTEGER, references: { model: 'Reports', key: 'id' } },
      createdAt
    });
    await queryInterface.addIndex('ReportHides', ['reporterId', 'reportedId'], { unique: true });

    await queryInterface.createTable('Notifications', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: userRef,
      type: { type: Sequelize.STRING, allowNull: false },
      payload: { type: Sequelize.JSONB, defaultValue: {} },
      link: Sequelize.STRING,
      readAt: Sequelize.DATE,
      createdAt
    });
    await queryInterface.addIndex('Notifications', ['userId', 'readAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Notifications');
    await queryInterface.dropTable('ReportHides');
    await queryInterface.dropTable('Reports');
    await queryInterface.dropTable('Blocks');
    await queryInterface.dropTable('Skips');
    await queryInterface.dropTable('Messages');
  }
};
