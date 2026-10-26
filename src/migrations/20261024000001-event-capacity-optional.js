// An event can now have no limit: capacity may be empty.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Events', 'capacity', { type: Sequelize.INTEGER, allowNull: true });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('UPDATE "Events" SET "capacity" = 0 WHERE "capacity" IS NULL');
    await queryInterface.changeColumn('Events', 'capacity', { type: Sequelize.INTEGER, allowNull: false });
  }
};
