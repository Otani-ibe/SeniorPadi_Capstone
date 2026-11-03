// Finds latitude / longitude for every senior and event that has none (new ones are done on save, this is for earlier rows and the sample data).
//   npm run geo:backfill             database in .env (DB_TARGET=local is your computer)
//   npm run geo:backfill:neon        Neon (live) database
//   npm run geo:backfill -- --dry    only count what would be looked up
//   npm run geo:backfill -- --all    look everything up again, even rows with coordinates
// one request a second, about a minute per 50 places. Only fills blanks (--all replaces coordinates), changes nothing else.
// the database must be migrated already, start the app once first
require('dotenv').config({ quiet: true });
const { Op } = require('sequelize');
const { sequelize, User, Event } = require('../models');
const { geocodeRecord } = require('../services/geocode');

const dry = process.argv.includes('--dry');
const all = process.argv.includes('--all');
const log = (text) => console.log(text);

async function main() {
  const { getDatabaseSettings } = require('../config/database');
  log((dry ? 'DRY RUN on ' : 'Looking up places on ') + getDatabaseSettings().host + ' ...');

  const blank = all ? {} : { geocodedAt: { [Op.is]: null } };
  const seniors = await User.findAll({ where: { role: 'senior', ...blank }, attributes: ['id', 'fullName', 'area', 'lga'] });
  const events = await Event.findAll({ where: blank, attributes: ['id', 'title', 'locationText', 'area'] });
  log(seniors.length + ' senior(s) and ' + events.length + ' event(s) to look up.');
  if (dry) return;

  const counts = { geocoded: 0, area: 0, none: 0 };
  const tally = (found) => { counts[found ? found.geoSource : 'none']++; };
  for (const s of seniors) {
    const found = await geocodeRecord('user', s.id);
    tally(found);
    log('  ' + s.fullName + ': ' + (found ? found.geoSource : 'no place to look up'));
  }
  for (const e of events) {
    const found = await geocodeRecord('event', e.id);
    tally(found);
    log('  ' + e.title + ': ' + (found ? found.geoSource : 'no place to look up'));
  }
  log('\nExact address found: ' + counts.geocoded + '. Middle of the area used: ' + counts.area + '. Nothing to look up: ' + counts.none + '.');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
