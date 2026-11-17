// a NIN nobody decided on within 10 days is erased and marked 'expired' (services/identity.js expireStale)
module.exports = {
  async up(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_status_valid"');
    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_status_valid" CHECK ('
      + '"status" IN (\'submitted\', \'verified\', \'not_eligible\', \'rejected\', \'expired\'))');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('UPDATE "IdentityVerifications" SET "status" = \'rejected\', "decisionNote" = \'Expired\' WHERE "status" = \'expired\'');
    await sql('ALTER TABLE "IdentityVerifications" DROP CONSTRAINT IF EXISTS "IdentityVerifications_status_valid"');
    await sql('ALTER TABLE "IdentityVerifications" ADD CONSTRAINT "IdentityVerifications_status_valid" CHECK ('
      + '"status" IN (\'submitted\', \'verified\', \'not_eligible\', \'rejected\'))');
  }
};
