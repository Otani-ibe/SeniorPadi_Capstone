// Runs database migrations when the app starts.
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// Our own small migration runner (no extra package needed).
// It uses the same "SequelizeMeta" table as sequelize-cli: one row per migration
// that has run. Anything already listed there is skipped.

// the migration files in name order (they start with a date, so that's run order)
function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.js')).sort();
}

async function executedMigrations(sequelize) {
  await sequelize.query('CREATE TABLE IF NOT EXISTS "SequelizeMeta" ("name" VARCHAR(255) NOT NULL PRIMARY KEY)');
  const [rows] = await sequelize.query('SELECT "name" FROM "SequelizeMeta"');
  return rows.map((row) => row.name);
}

// runs anything that hasn't run yet. Returns the names of what ran.
async function runMigrations(sequelize) {
  const done = await executedMigrations(sequelize);
  const queryInterface = sequelize.getQueryInterface();
  const ran = [];

  for (const file of migrationFiles()) {
    if (done.includes(file)) continue;

    const migration = require(path.join(MIGRATIONS_DIR, file));
    try {
      await migration.up(queryInterface, Sequelize);
    } catch (err) {
      throw new Error('Database update ' + file + ' failed: ' + err.message);
    }
    await sequelize.query('INSERT INTO "SequelizeMeta" ("name") VALUES (:name)', { replacements: { name: file } });
    ran.push(file);
  }
  return ran;
}

async function migrationStatus(sequelize) {
  const done = await executedMigrations(sequelize);
  const files = migrationFiles();
  return {
    executed: files.filter((f) => done.includes(f)),
    pending: files.filter((f) => !done.includes(f))
  };
}

// tables the app needs that aren't in the database
async function findMissingTables(sequelize) {
  const existing = (await sequelize.getQueryInterface().showAllTables())
    .map((t) => (typeof t === 'string' ? t : t.tableName));
  return Object.values(sequelize.models)
    .map((model) => model.getTableName())
    .map((name) => (typeof name === 'string' ? name : name.tableName))
    .filter((name) => !existing.includes(name));
}

// Makes sure the database has everything the app needs.
// 1. runs new migrations (skips ones already done)
// 2. if the migration record says "done" but tables are missing
//    (for example someone deleted tables by hand), creates the missing ones
// Never deletes or changes existing data.
async function ensureDatabase(sequelize) {
  const ran = await runMigrations(sequelize);

  const missing = await findMissingTables(sequelize);
  if (missing.length > 0) {
    await sequelize.sync(); // only creates tables that don't exist
  }

  return { ran, repaired: missing };
}

module.exports = { runMigrations, migrationStatus, ensureDatabase, findMissingTables };
