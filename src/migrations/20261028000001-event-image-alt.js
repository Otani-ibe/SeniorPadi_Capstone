// What the event picture shows, written by staff, so screen readers can read the flyer out.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'imageAlt', { type: Sequelize.TEXT, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'imageAlt');
  }
};
