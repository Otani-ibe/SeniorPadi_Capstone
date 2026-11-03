// Identity checks by NIN replace the photo-of-an-ID check. (This first version assumed an outside lookup service; it was
// changed to review by a person in 20261104000001-nin-manual-review.js, which reshapes the table below.)
//
//  - Users.verificationStatus gets two more values: 'not_eligible' (the NIN says they are under 50) and
//    'manual_review' (the details could not be matched, so a person looks). 'approved' keeps its name; it means "verified".
//  - A senior whose old ID photo was still waiting ('pending') goes back to 'unverified' and verifies with their NIN.
//    Everyone already 'approved' (including the demo seniors) keeps their access.
//  - IdentityVerifications records each check: the result only. The NIN itself is never stored. The only value
//    derived from it is a keyed hash (ninHash), used to spot one NIN on two accounts.
//
// The old ID photo columns (Users.idDocumentPublicId / idDocumentFormat) are left in place, unused, so no file is
// orphaned by accident. `npm run ids:purge` deletes the stored photos and clears the columns.
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (text) => queryInterface.sequelize.query(text);

    await sql('ALTER TYPE "enum_Users_verificationStatus" ADD VALUE IF NOT EXISTS \'not_eligible\'');
    await sql('ALTER TYPE "enum_Users_verificationStatus" ADD VALUE IF NOT EXISTS \'manual_review\'');
    await sql('UPDATE "Users" SET "verificationStatus" = \'unverified\' WHERE "verificationStatus" = \'pending\'');

    await queryInterface.createTable('IdentityVerifications', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      provider: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'dojah' },
      providerReference: Sequelize.STRING(64),
      status: { type: Sequelize.STRING(16), allowNull: false },
      identityResult: Sequelize.STRING(12), // 'found', 'not_found' or 'error'
      ageEligible: Sequelize.BOOLEAN, // 50 or older
      nameMatch: Sequelize.BOOLEAN, // the name on the NIN matches the name on the account
      phoneMatch: Sequelize.BOOLEAN, // the phone number on the NIN matches the account's
      reviewReason: Sequelize.STRING(24), // why a person has to look: 'no_match', 'no_birth_date' or 'duplicate_nin'
      ninHash: Sequelize.STRING(64),
      consentAt: { type: Sequelize.DATE, allowNull: false },
      submittedAt: { type: Sequelize.DATE, allowNull: false },
      completedAt: Sequelize.DATE,
      reviewedByAdminId: Sequelize.INTEGER,
      reviewedAt: Sequelize.DATE,
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_status_valid" CHECK ('
      + '"status" IN (\'processing\', \'verified\', \'not_eligible\', \'rejected\', \'manual_review\', \'error\'))');
    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_identity_valid" CHECK ('
      + '"identityResult" IS NULL OR "identityResult" IN (\'found\', \'not_found\', \'error\'))');

    await queryInterface.addIndex('IdentityVerifications', ['userId', 'createdAt']);
    await queryInterface.addIndex('IdentityVerifications', ['status']);
    // one NIN can be verified on one account only
    await queryInterface.addIndex('IdentityVerifications', ['ninHash'], {
      unique: true, where: { status: 'verified' }, name: 'identity_verifications_verified_nin_unique'
    });
  },

  async down(queryInterface) {
    // (the two new enum values cannot be removed from a Postgres enum; unused, they do no harm)
    await queryInterface.dropTable('IdentityVerifications');
  }
};
