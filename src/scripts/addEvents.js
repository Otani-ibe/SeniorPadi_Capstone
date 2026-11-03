// Adds (or removes) the Ibadan events list and the organizations that host them. See src/services/sampleEvents.js.
//
//   npm run events:add              add them to the database in .env (DB_TARGET=local is your own computer)
//   npm run events:add:neon         add them to the Neon (live) database
//   npm run events:add -- --dry     only show what would be added
//   npm run events:remove           take them out again: only events from the list that nobody has registered for,
//                                   and organizations that were added for them and now have no event
//
// Adding only ever adds (and fills in a blank number of places, area or flyer). It never removes or overwrites anything. It does not
// change the database layout: the live database is brought up to date when the app starts, so deploy the app first.
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
