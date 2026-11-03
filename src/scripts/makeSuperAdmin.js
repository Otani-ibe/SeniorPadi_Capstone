// Makes an existing staff account the superadmin: the only account that can open the NINs seniors send.
// Their phone number and password are not touched. Other admins cannot see NINs.
//
//   npm run superadmin -- --phone 08012345678                     make that admin the superadmin
//   npm run superadmin -- --phone 08012345678 --name "Otani Ibe"  ...and change their name
//   npm run superadmin -- --phone 08012345678 --off               take the role away again
//   npm run superadmin:neon -- --phone ...                        the same on the Neon (live) database
//
// The account must already be an admin. The database must be up to date (it is when the app has been started once).
require('dotenv').config({ quiet: true });
const { sequelize, User } = require('../models');
const { normalizePhone } = require('../services/phone');

function argument(name) {
  const at = process.argv.indexOf('--' + name);
  return at > -1 ? process.argv[at + 1] : null;
}

async function main() {
  const { getDatabaseSettings } = require('../config/database');
  const phone = normalizePhone(argument('phone'));
  const name = (argument('name') || '').trim();
  const off = process.argv.includes('--off');
  if (!phone) throw new Error('Give the admin\'s phone number: --phone 08012345678');

  console.log('On ' + getDatabaseSettings().host + ' ...');
  const admin = await User.findOne({ where: { phone, role: 'admin' } });
  if (!admin) throw new Error('No admin account has the number ' + phone + '. (Staff accounts are made with npm run create-admin.)');

  const before = admin.fullName;
  await admin.update({ isSuperAdmin: !off, ...(name && !off ? { fullName: name } : {}) });
  console.log(off
    ? before + ' is no longer the superadmin.'
    : (name && name !== before ? before + ' is now ' + name + ', and' : before + ' is now') + ' the superadmin. Their phone number and password are unchanged.');

  const all = await User.findAll({ where: { role: 'admin', isSuperAdmin: true }, attributes: ['fullName', 'phone'] });
  console.log('Superadmins: ' + (all.map((a) => a.fullName + ' (' + a.phone + ')').join(', ') || 'none'));
}

main()
  .catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
