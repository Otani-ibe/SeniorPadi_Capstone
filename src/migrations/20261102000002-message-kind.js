// a chat line can be something other than text, for now 'missed_call' (written by the system when a call rings out). 'text' for every existing message
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Messages', 'kind', { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'text' });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Messages', 'kind');
  }
};
