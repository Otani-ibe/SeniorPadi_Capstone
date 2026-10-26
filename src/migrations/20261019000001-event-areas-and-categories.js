// Events get a local government area (so seniors can filter by where they live)
// and two new categories: charity and creativity.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'area', { type: Sequelize.STRING(40), allowNull: true });
    await queryInterface.addIndex('Events', ['area']);

    // Postgres can add values to an existing ENUM type, but not inside a transaction
    for (const value of ['charity', 'creativity']) {
      await queryInterface.sequelize.query(`ALTER TYPE "enum_Events_category" ADD VALUE IF NOT EXISTS '${value}'`);
    }
  },

  async down(queryInterface) {
    // Postgres can't remove ENUM values, so only the column goes
    await queryInterface.removeColumn('Events', 'area');
  }
};
