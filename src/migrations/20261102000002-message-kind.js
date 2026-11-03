// A line in a chat can be something other than text: for now, "missed call" (written by the system when a call
// rings out). 'text' is every message that already exists.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Messages', 'kind', { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'text' });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Messages', 'kind');
  }
};
