// Finds latitude / longitude for every senior and event that has none yet (new ones are done as they are
// saved; this is for the ones that were there before, and for the sample events and seniors).
//
//   npm run geo:backfill             the database in .env (DB_TARGET=local is your own computer)
//   npm run geo:backfill:neon        the Neon (live) database
//   npm run geo:backfill -- --dry    only count what would be looked up
//   npm run geo:backfill -- --all    look everything up again, even what already has coordinates
//
// The lookup service allows one request a second, so about a minute per 50 places. It only fills in
// blanks (or, with --all, replaces coordinates); it never changes anything else. The database must
// already be up to date: it is migrated when the app starts, so start the app once first.
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
