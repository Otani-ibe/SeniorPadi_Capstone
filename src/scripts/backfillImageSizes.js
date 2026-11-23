// Fills in imageWidth / imageHeight for events whose picture is on Cloudinary and has no size saved yet.
//   npm run images:sizes          local database
//   npm run images:sizes:neon     live database
require('dotenv').config({ quiet: true });
const { Op } = require('sequelize');
const { sequelize, Event } = require('../models');
const cloud = require('../services/cloudinary');

async function main() {
  if (!cloud.isConfigured()) throw new Error('Cloudinary keys are not set.');
  const events = await Event.findAll({ where: { imagePublicId: { [Op.not]: null }, imageWidth: null } });
  let done = 0;
  for (const event of events) {
    if (event.imagePublicId.startsWith('local:')) continue;
    try {
      const info = await cloud.cloudinary.api.resource(event.imagePublicId);
      await event.update({ imageWidth: info.width, imageHeight: info.height });
      done++;
    } catch (err) {
      console.log('Skipped event ' + event.id + ': ' + err.message);
    }
  }
  console.log('Saved the picture size for ' + done + ' of ' + events.length + ' event(s).');
}

main().catch((err) => { console.error('Failed:', err.message); process.exitCode = 1; }).finally(() => sequelize.close());
