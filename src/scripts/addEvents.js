// Adds (or removes) the Ibadan events list and the organizations hosting them. See src/services/sampleEvents.js.
//   npm run events:add              add to the database in .env (DB_TARGET=local is your computer)
//   npm run events:add:neon         add to the Neon (live) database
//   npm run events:add -- --dry     only show what would be added
//   npm run events:remove           take them out again: listed events nobody registered for, and organizations added for them that are now empty
// adding only adds (and fills a blank capacity, area or flyer), never removes or overwrites. No schema change:
// the live database is migrated when the app starts, so deploy first
require('dotenv').config({ quiet: true });
const { sequelize } = require('../models');
const { addSampleEvents, removeSampleEvents, ALL } = require('../services/sampleEvents');

const dry = process.argv.includes('--dry');
const remove = process.argv.includes('--remove');
const log = (text) => console.log(text);

async function main() {
  const { getDatabaseSettings } = require('../config/database');
  log((dry ? 'DRY RUN on ' : remove ? 'Removing from ' : 'Adding to ') + getDatabaseSettings().host + ' ...');

  if (remove) {
    const result = await removeSampleEvents(require('../models'), { dry, log, include: ALL });
    log('\nRemoved ' + result.events + ' event(s) and ' + result.orgs + ' organization(s).');
    return;
  }

  const result = await addSampleEvents(require('../models'), { dry, log, include: ALL });
  log('\n' + (dry ? 'Would add ' : 'Added ') + result.events + ' event(s) and ' + result.orgs + ' organization(s).');
  if (result.filled) log((dry ? 'Would fill' : 'Filled') + ' in the places, area or flyer on ' + result.filled + ' event(s) that were already there.');
  if (result.skipped.length) {
    log('Skipped ' + result.skipped.length + ' that already exist:');
    result.skipped.forEach((s) => log('  - ' + s));
  }
}

main()
  .then(() => sequelize.close())
  .catch((err) => { console.error(err); process.exit(1); });
