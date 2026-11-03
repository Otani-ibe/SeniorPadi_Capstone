// latitude / longitude (degrees, WGS84) for where a senior lives and where an event is held, to rank events by real distance. See services/geo.js, geocode.js, nearby.js.
// plain DOUBLE PRECISION, not PostGIS, so the same migration runs on every database we use (a typical local Postgres has no PostGIS).
// distance is computed in the backend. A geography column can be added later next to these.
// geoSource: 'geocoded' (looked up from the address) or 'area' (centre of their LGA, when the address was not found)
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
