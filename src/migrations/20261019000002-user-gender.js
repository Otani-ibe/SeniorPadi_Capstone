// female or male, picks the illustration shown until they upload a photo
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'gender', { type: Sequelize.STRING(10), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'gender');
  }
};
