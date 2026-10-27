// Where an organization is, so staff can search and filter the list by local government area.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Organizations', 'address', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('Organizations', 'lga', { type: Sequelize.STRING(40), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Organizations', 'address');
    await queryInterface.removeColumn('Organizations', 'lga');
  }
};
