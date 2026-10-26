// The local government area a senior lives in. Find events opens on it first.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'lga', { type: Sequelize.STRING(40), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'lga');
  }
};
