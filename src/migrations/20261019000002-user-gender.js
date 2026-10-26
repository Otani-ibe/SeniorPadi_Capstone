// Seniors can say if they are female or male. It picks the illustration
// shown in place of a profile picture until they upload their own.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'gender', { type: Sequelize.STRING(10), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'gender');
  }
};
