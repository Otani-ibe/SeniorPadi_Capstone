// An event can be marked "show first": it comes ahead of every other event on the Events page and the home page.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'featured', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'featured');
  }
};
