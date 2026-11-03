// Deletes the ID photos that seniors uploaded under the old "send a photo of your ID" check, and clears the
// columns that pointed at them. Identity is now checked with the NIN (see docs/nin-verification.md), so these
// photos have no purpose left and should not be kept.
//
//   npm run ids:purge -- --dry     only count them
//   npm run ids:purge              delete the files and clear the columns, on the database in .env (DB_TARGET=local = your computer)
//   npm run ids:purge:neon         the same on the Neon (live) database
//
// Run --dry first. This cannot be undone.
require('dotenv').config({ quiet: true });
const { sequelize } = require('../models');
const cloud = require('../services/cloudinary');

const dry = process.argv.includes('--dry');

async function main() {
  const { getDatabaseSettings } = require('../config/database');
  console.log((dry ? 'DRY RUN on ' : 'Deleting ID photos on ') + getDatabaseSettings().host + ' ...');

  // the columns are no longer in the model, so this reads them directly
  const [columns] = await sequelize.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'Users\' AND column_name = \'idDocumentPublicId\'');
  if (columns.length === 0) {
    console.log('There is no ID photo column in this database. Nothing to do.');
    return;
  }
  const [rows] = await sequelize.query('SELECT id, "idDocumentPublicId" AS "publicId" FROM "Users" WHERE "idDocumentPublicId" IS NOT NULL');
  console.log(rows.length + ' stored ID photo(s).');
  if (dry || rows.length === 0) return;

  let deleted = 0;
  for (const row of rows) {
    try {
      await cloud.deleteFile(row.publicId, 'private');
      deleted++;
    } catch (err) {
      console.error('  could not delete the file of user ' + row.id + ' (' + err.message + '); its reference is kept so you can try again');
      continue;
    }
    await sequelize.query('UPDATE "Users" SET "idDocumentPublicId" = NULL, "idDocumentFormat" = NULL WHERE id = :id', { replacements: { id: row.id } });
  }
  console.log('Deleted ' + deleted + ' of ' + rows.length + ' photo(s).');
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
