// When a son or daughter signs a parent up, we keep who they are, so staff can see it.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'createdByName', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('Users', 'createdByPhone', { type: Sequelize.STRING, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'createdByName');
    await queryInterface.removeColumn('Users', 'createdByPhone');
  }
};
