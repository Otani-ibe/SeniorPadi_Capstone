const { sequelize, User } = require('../src/models');
const { runMigrations, migrationStatus } = require('../src/services/migrate');
const startup = require('../src/services/startup');

beforeAll(async () => {
  // start from a completely empty database
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});
afterAll(async () => {
  await sequelize.close();
});

test('migrations run on an empty database, then are skipped next time', async () => {
  const first = await runMigrations(sequelize);
  expect(first.length).toBeGreaterThan(0);

  const second = await runMigrations(sequelize);
  expect(second).toEqual([]);

  const status = await migrationStatus(sequelize);
  expect(status.pending).toEqual([]);
});

test('the first admin is created from the settings, only once', async () => {
  process.env.ADMIN_PHONE = '08011112222';
  process.env.ADMIN_PASSWORD = 'longenough1';
  const models = require('../src/models');

  expect(await startup.ensureFirstAdmin(models)).toBe('created');
  expect(await startup.ensureFirstAdmin(models)).toBe('exists');
  expect(await User.count({ where: { role: 'admin' } })).toBe(1);
});

test('default welcome guide text is added once', async () => {
  const models = require('../src/models');
  expect(await startup.ensureDefaultContent(models)).toBe(2);
  expect(await startup.ensureDefaultContent(models)).toBe(0);
});
