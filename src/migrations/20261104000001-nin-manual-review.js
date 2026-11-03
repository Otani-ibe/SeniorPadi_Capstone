// Identity checks are done by a person, not by a provider: a senior types their NIN, it is saved ENCRYPTED, and the
// superadmin checks it on the official NIMC website and decides. See docs/nin-verification.md.
//
//  - Users.isSuperAdmin: the only staff account that can open a NIN. (Other admins cannot.)
//  - IdentityVerifications: the provider columns go; encryptedNin (AES-256-GCM, see services/identity.js) and decisionNote
//    arrive. The encrypted NIN is erased as soon as the superadmin decides. Statuses are now
//    submitted / verified / not_eligible / rejected.
//  - A senior who was 'manual_review' (the earlier, provider-based design) goes back to 'unverified' to send their NIN again.
//    'approved' seniors, including the demo seniors, keep their access.
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (text) => queryInterface.sequelize.query(text);

    await queryInterface.addColumn('Users', 'isSuperAdmin', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

    // rows from the provider-based design that never reached a decision carry no NIN, so they cannot be reviewed
    await sql('UPDATE "Users" SET "verificationStatus" = \'unverified\' WHERE "verificationStatus" IN (\'manual_review\', \'pending\')');
    await sql('DELETE FROM "IdentityVerifications" WHERE "status" NOT IN (\'verified\', \'not_eligible\', \'rejected\')');

    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_status_valid"');
    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_identity_valid"');
    for (const column of ['provider', 'providerReference', 'identityResult', 'ageEligible', 'nameMatch', 'phoneMatch', 'reviewReason']) {
      await queryInterface.removeColumn('IdentityVerifications', column);
    }
    await queryInterface.addColumn('IdentityVerifications', 'encryptedNin', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('IdentityVerifications', 'decisionNote', { type: Sequelize.STRING(300), allowNull: true });

    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_status_valid" CHECK ('
      + '"status" IN (\'submitted\', \'verified\', \'not_eligible\', \'rejected\'))');
    // a NIN is only ever kept while it waits for a decision
    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_nin_only_while_waiting" CHECK ('
      + '"encryptedNin" IS NULL OR "status" = \'submitted\')');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_nin_only_while_waiting"');
    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_status_valid"');
    await queryInterface.removeColumn('IdentityVerifications', 'decisionNote');
    await queryInterface.removeColumn('IdentityVerifications', 'encryptedNin');
    await queryInterface.removeColumn('Users', 'isSuperAdmin');
  }
};
