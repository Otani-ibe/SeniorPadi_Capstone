// Adds the demo seniors (src/scripts/data/seniors.js) to the database in .env, all verified. Safe to rerun. See src/services/sampleSeniors.js.
//   npm run seniors:add        database in .env
//   npm run seniors:add:neon   Neon (live) database
// never run by the site itself
require('dotenv').config({ quiet: true });
const { sequelize } = require('../models');
const { ensureSampleSeniors } = require('../services/sampleSeniors');

async function main() {
  const { getDatabaseSettings } = require('../config/database');
  console.log('Seniors on ' + getDatabaseSettings().host + ' ...');
  const result = await ensureSampleSeniors(require('../models'), { log: (t) => console.log(t) });
  console.log('\nAdded ' + result.created + ' account(s), updated ' + result.updated + '.\n');
  console.log('Name                      Phone         Gender  Picture');
  for (const p of result.list) {
    console.log(p.name.padEnd(25) + ' ' + p.local + '   ' + p.gender.padEnd(7) + ' ' + (p.photo ? 'yes' : 'NO'));
  }
}

main()
  .then(() => require('../services/geocode').idle())
  .then(() => sequelize.close())
  .catch((err) => { console.error(err); process.exit(1); });
