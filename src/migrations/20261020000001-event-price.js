// What an event costs, in naira. Empty means it costs nothing.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'price', { type: Sequelize.INTEGER, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'price');
  }
};
