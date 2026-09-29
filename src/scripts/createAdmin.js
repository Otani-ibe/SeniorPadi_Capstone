// Usage: npm run create-admin -- "Full Name" 08031234567 password
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { sequelize, User } = require('../models');
const { normalizePhone } = require('../services/phone');

async function main() {
  const [fullName, rawPhone, password] = process.argv.slice(2);
  const phone = normalizePhone(rawPhone);

  if (!fullName || !phone || !password || password.length < 8) {
    console.log('Usage: npm run create-admin -- "Full Name" 08031234567 a-password-of-8-or-more');
    process.exit(1);
  }

  // make sure all the tables exist first (same as when the app starts)
  await require('../services/migrate').ensureDatabase(sequelize);

  const user = await User.create({
    fullName,
    phone,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    ageDeclared: false
  });
  console.log('Admin created: ' + user.fullName + ' (' + user.phone + ')');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
