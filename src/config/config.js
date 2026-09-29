// Sequelize settings. sequelize-cli (migrations) reads this file too.
const { getDatabaseSettings } = require('./database');

const db = getDatabaseSettings();

const settings = {
  dialect: 'postgres',
  url: db.url,
  logging: false,
  timezone: '+00:00', // store everything in UTC
  dialectOptions: db.ssl ? { ssl: db.ssl } : {},
  pool: { max: 5, min: 0, idle: 10000, acquire: 30000 }
};

// the database is picked by DB_TARGET, not by NODE_ENV,
// so every environment uses the same settings object
module.exports = {
  development: settings,
  test: settings,
  production: settings
};
