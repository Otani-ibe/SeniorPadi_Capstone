// The host organization's check-in link: a private address for one event's guest list,
// so they can tick people in at the door without an account. Their ticks are recorded as 'host'.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'checkinToken', { type: Sequelize.STRING(64), allowNull: true, unique: true });
    await queryInterface.addColumn('Events', 'checkinTokenAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query('ALTER TYPE "enum_Attendances_method" ADD VALUE IF NOT EXISTS \'host\'');
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'checkinToken');
    await queryInterface.removeColumn('Events', 'checkinTokenAt');
    // Postgres can't take a value out of an enum; 'host' is left in place
  }
};
