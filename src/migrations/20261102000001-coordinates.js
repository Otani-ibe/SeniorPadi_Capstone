// Where a senior lives and where an event is held, as latitude / longitude (degrees, WGS84),
// so events can be ranked by real distance. See services/geo.js, geocode.js and nearby.js.
//
// Plain DOUBLE PRECISION columns rather than PostGIS: the same migration then runs on every
// database we use (PostGIS is not installed on a typical local Postgres). The distance is worked
// out in the backend. If the live database later gets PostGIS, a geography column can be added
// next to these without changing anything else.
//
// geoSource says how the numbers were found: 'geocoded' (looked up from the address) or 'area'
// (the middle of their local government area, used when the address could not be found).
const TABLES = ['Users', 'Events'];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      await queryInterface.addColumn(table, 'latitude', { type: Sequelize.DOUBLE, allowNull: true });
      await queryInterface.addColumn(table, 'longitude', { type: Sequelize.DOUBLE, allowNull: true });
      await queryInterface.addColumn(table, 'geoSource', { type: Sequelize.STRING(12), allowNull: true });
      await queryInterface.addColumn(table, 'geocodedAt', { type: Sequelize.DATE, allowNull: true });

      // bad numbers can never be stored, and a pair is either complete or empty
      await queryInterface.sequelize.query(
        'ALTER TABLE "' + table + '" ADD CONSTRAINT "' + table + '_coordinates_valid" CHECK ('
        + '("latitude" IS NULL AND "longitude" IS NULL) OR '
        + '("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND '
        + '"latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))'
      );
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      await queryInterface.sequelize.query('ALTER TABLE "' + table + '" DROP CONSTRAINT IF EXISTS "' + table + '_coordinates_valid"');
      for (const column of ['geocodedAt', 'geoSource', 'longitude', 'latitude']) await queryInterface.removeColumn(table, column);
    }
  }
};
