// the picture's width and height, so pages can save its space before it loads (no jumping) and pick a smaller copy
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Events', 'imageWidth', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Events', 'imageHeight', { type: Sequelize.INTEGER, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Events', 'imageHeight');
    await queryInterface.removeColumn('Events', 'imageWidth');
  }
};
