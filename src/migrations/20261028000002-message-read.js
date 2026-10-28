// When the recipient opened the conversation, so the sender can see "Read".
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Messages', 'readAt', { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Messages', 'readAt');
  }
};
