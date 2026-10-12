'use strict';

// Ticket numbers, an attendance table, phone/email verification,
// phone number exchange, reminder settings and saved translations.
module.exports = {
  async up(queryInterface, Sequelize) {
    const userRef = { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } };
    const timestamps = {
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    };

    // --- users: verification and reminders ---
    await queryInterface.addColumn('Users', 'phoneVerifiedAt', { type: Sequelize.DATE });
    await queryInterface.addColumn('Users', 'emailVerifiedAt', { type: Sequelize.DATE });
    await queryInterface.addColumn('Users', 'remindersEnabled', { type: Sequelize.BOOLEAN, defaultValue: true });

    // --- registrations: ticket number (the pass for the event) ---
    await queryInterface.addColumn('Registrations', 'ticketNumber', { type: Sequelize.STRING(12) });
    // give existing registrations a ticket too
    await queryInterface.sequelize.query(`
      UPDATE "Registrations"
      SET "ticketNumber" = 'SP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
      WHERE "ticketNumber" IS NULL
    `);
    await queryInterface.changeColumn('Registrations', 'ticketNumber', { type: Sequelize.STRING(12), allowNull: false });
    await queryInterface.addIndex('Registrations', ['ticketNumber'], { unique: true });

    // --- attendance: one row per person who came ---
    await queryInterface.createTable('Attendances', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      eventId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Events', key: 'id' } },
      registrationId: { type: Sequelize.INTEGER, allowNull: false, unique: true, references: { model: 'Registrations', key: 'id' } },
      seniorId: userRef,
      method: { type: Sequelize.ENUM('manual', 'qr', 'ticket'), allowNull: false, defaultValue: 'manual' },
      checkedInAt: { type: Sequelize.DATE, allowNull: false },
      markedByAdminId: { type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' } },
      ...timestamps
    });
    await queryInterface.addIndex('Attendances', ['eventId']);
    // anyone already marked as attended gets an attendance row
    await queryInterface.sequelize.query(`
      INSERT INTO "Attendances" ("eventId", "registrationId", "seniorId", "method", "checkedInAt", "createdAt", "updatedAt")
      SELECT "eventId", "id", "seniorId", 'manual', "updatedAt", NOW(), NOW()
      FROM "Registrations" WHERE "status" = 'attended'
    `);

    // --- phone number exchange ---
    await queryInterface.createTable('PhoneExchanges', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      requesterId: userRef,
      recipientId: userRef,
      status: { type: Sequelize.ENUM('pending', 'accepted', 'declined'), defaultValue: 'pending' },
      respondedAt: Sequelize.DATE,
      ...timestamps
    });
    await queryInterface.addIndex('PhoneExchanges', ['requesterId', 'recipientId'], { unique: true });

    // --- verification codes ---
    await queryInterface.createTable('VerificationCodes', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: userRef,
      channel: { type: Sequelize.ENUM('phone', 'email'), allowNull: false },
      codeHash: { type: Sequelize.STRING, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      usedAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('VerificationCodes', ['userId', 'channel']);

    // --- saved Google Translate results ---
    await queryInterface.createTable('Translations', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      sourceHash: { type: Sequelize.STRING(64), allowNull: false },
      targetLang: { type: Sequelize.STRING(8), allowNull: false },
      sourceText: { type: Sequelize.TEXT, allowNull: false },
      translatedText: { type: Sequelize.TEXT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('Translations', ['sourceHash', 'targetLang'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Translations');
    await queryInterface.dropTable('VerificationCodes');
    await queryInterface.dropTable('PhoneExchanges');
    await queryInterface.dropTable('Attendances');
    await queryInterface.removeColumn('Registrations', 'ticketNumber');
    await queryInterface.removeColumn('Users', 'remindersEnabled');
    await queryInterface.removeColumn('Users', 'emailVerifiedAt');
    await queryInterface.removeColumn('Users', 'phoneVerifiedAt');
  }
};
