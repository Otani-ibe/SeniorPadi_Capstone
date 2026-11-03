// "show first": the event comes ahead of every other on the Events page and home page
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'featured', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'featured');
  }
};
