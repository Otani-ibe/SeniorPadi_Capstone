// Lets a senior hide their online/offline dot from other seniors.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'showOnlineStatus', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'showOnlineStatus');
  }
};
