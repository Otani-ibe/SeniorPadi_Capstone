// Tells you which database the app will use and whether it can reach it.
// Usage: npm run db:check   (or db:check:local / db:check:neon)
const dns = require('dns').promises;
const { getDatabaseSettings } = require('../config/database');

async function main() {
  const db = getDatabaseSettings();
  console.log('Target:   ' + db.target);
  console.log('Host:     ' + db.host);
  console.log('SSL:      ' + (db.ssl ? 'on' : 'off'));

  // look up the address first, so network problems are easy to spot
  if (!['localhost', '127.0.0.1', '::1'].includes(db.host)) {
    try {
      const found = await dns.lookup(db.host);
      console.log('DNS:      ok (' + found.address + ')');
    } catch (err) {
      console.log('DNS:      FAILED (' + err.code + ')');
      console.log('\nYour computer could not find this host. Check your internet, try another');
      console.log('network, or change your DNS to 8.8.8.8. Or use DB_TARGET=local for now.');
      process.exit(1);
    }
  }

  const { sequelize } = require('../models');
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query('SELECT current_database() AS name, version() AS version');
    console.log('Database: ' + rows[0].name);
    console.log('Connected: yes (' + rows[0].version.split(',')[0] + ')');
  } catch (err) {
    console.log('Connected: NO');
    console.log((err.parent && err.parent.message) || err.message || err.name);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
