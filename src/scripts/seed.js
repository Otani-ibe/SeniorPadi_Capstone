// Fills the database with demo data. Wipes existing data first!
// Usage: npm run seed
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { sequelize, User, Organization, Event, Registration, Message, OnboardingVideo } = require('../models');
const en = require('../../locales/en.json');
const yo = require('../../locales/yo.json');
const { DAY_MS } = require('../services/dates');

// a date N days from now at a given Lagos hour
function daysFromNow(days, hour) {
  const d = new Date(Date.now() + days * DAY_MS);
  d.setUTCHours(hour - 1, 0, 0, 0); // Lagos is UTC+1
  return d;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('Not seeding a production database.');
    process.exit(1);
  }

  // seeding wipes everything, so a cloud database needs an extra flag
  const { getDatabaseSettings } = require('../config/database');
  const db = getDatabaseSettings();
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(db.host);
  if (!isLocal && !process.argv.includes('--yes-wipe-neon')) {
    console.log('This would wipe the database on ' + db.host + '.');
    console.log('If that is really what you want, run: npm run seed:neon');
    process.exit(1);
  }
  console.log('Seeding ' + db.host + ' ...');

  // make sure all the tables exist first (same as when the app starts)
  await require('../services/migrate').ensureDatabase(sequelize);

  await sequelize.query('TRUNCATE "OnboardingVideos", "Notifications", "ReportHides", "Reports", "Blocks", "Skips", "Messages", "Registrations", "EventInterests", "PasswordResets", "AuditLogs", "Events", "Organizations", "Users" RESTART IDENTITY CASCADE');

  const password = await bcrypt.hash('password123', 10);

  const admin = await User.create({
    fullName: 'Funmi Adeyemi',
    phone: '+2348000000001',
    email: 'admin@seniorpadi.test',
    passwordHash: password,
    role: 'admin'
  });

  const names = [
    'Babatunde Ogunleye', 'Adunni Afolabi', 'Olusegun Adebayo', 'Kehinde Oladipo',
    'Mojisola Akinwale', 'Tunde Ajayi', 'Folake Ogundele', 'Ayodele Olatunji',
    'Iyabo Adewale', 'Gbenga Oyelaran'
  ];
  const bios = [
    'Retired teacher. I love telling stories and I want to learn to use my phone better.',
    'Grandmother of five. I sew, I cook, and I enjoy a good gist.',
    'Former civil servant. Morning walks keep me going. Looking for walking partners.',
    'I sing in the church choir and I would like to learn beading.',
    'Retired nurse. Happy to help at health events.',
    'I play draughts and ayo. Always looking for someone to beat!'
  ];
  const seniors = [];
  for (let i = 0; i < names.length; i++) {
    seniors.push(await User.create({
      fullName: names[i],
      phone: '+23480300000' + String(i + 10),
      email: i < 4 ? 'senior' + (i + 1) + '@seniorpadi.test' : null,
      passwordHash: password,
      ageDeclared: true,
      preferredLanguage: i % 3 === 0 ? 'yo' : 'en',
      reminderDaysBefore: (i % 3) + 1,
      area: ['Bodija', 'Challenge', 'Ring Road', 'Agodi', 'Mokola'][i % 5],
      // first 6 are verified for Find Seniors, number 7 is waiting for an ID check
      verificationStatus: i < 6 ? 'approved' : (i === 6 ? 'pending' : 'unverified'),
      bio: i < 6 ? bios[i] : null,
      onboardingSeenAt: i === 9 ? null : new Date() // the last one hasn't seen the welcome guide
    }));
  }

  const church = await Organization.create({
    name: 'St. Anne\'s Church, Molete',
    contactName: 'Mrs. Bola Ige',
    contactPhone: '0803 555 0101',
    createdByAdminId: admin.id
  });
  const gym = await Organization.create({
    name: 'Agodi Gardens Walking Club',
    contactName: 'Mr. Femi Oke',
    contactPhone: '0805 555 0202',
    contactEmail: 'walks@agodi.test',
    createdByAdminId: admin.id
  });
  const school = await Organization.create({
    name: 'Bodija Community Centre',
    contactName: 'Dr. Yemi Salako',
    contactPhone: '0807 555 0303',
    createdByAdminId: admin.id
  });

  const base = { createdByAdminId: admin.id, status: 'published' };

  // this week, lots of space, needs volunteers
  const walk = await Event.create({
    ...base,
    title: 'Morning walk in Agodi Gardens',
    description: 'A gentle one-hour walk around Agodi Gardens, at your own pace. Wear comfortable shoes and bring water. Chairs are available if you want to rest.',
    startsAt: daysFromNow(2, 7), endsAt: daysFromNow(2, 8),
    registrationDeadline: daysFromNow(1, 20),
    locationText: 'Agodi Gardens, main gate, Ibadan',
    locationMapsUrl: 'https://maps.google.com/?q=Agodi+Gardens+Ibadan',
    category: 'fitness', organizationId: gym.id,
    capacity: 30, volunteerEnabled: true, volunteerCapacity: 4
  });

  // this week, almost full
  const beading = await Event.create({
    ...base,
    title: 'Beading class for beginners',
    description: 'Learn to make a simple beaded necklace. All materials are provided. Take home what you make.',
    startsAt: daysFromNow(4, 10), endsAt: daysFromNow(4, 12),
    registrationDeadline: daysFromNow(3, 18),
    locationText: 'Bodija Community Centre, Hall B',
    locationMapsUrl: 'https://maps.google.com/?q=Bodija+Ibadan',
    category: 'skills', organizationId: school.id,
    capacity: 8
  });

  // this week, completely full
  const phones = await Event.create({
    ...base,
    title: 'Using WhatsApp video calls',
    description: 'Bring your phone and we will show you how to video call your children and grandchildren, step by step. Small group, lots of patience.',
    startsAt: daysFromNow(5, 14), endsAt: daysFromNow(5, 16),
    registrationDeadline: daysFromNow(4, 12),
    locationText: 'Bodija Community Centre, Computer Room',
    category: 'learning', organizationId: school.id,
    capacity: 3
  });

  // later, hosted by a senior
  const stories = await Event.create({
    ...base,
    title: 'Folktales afternoon with Baba Ogunleye',
    description: 'Retired teacher Baba Ogunleye tells Yoruba folktales. Stay for zobo and chin chin afterwards.',
    startsAt: daysFromNow(12, 15), endsAt: daysFromNow(12, 17),
    registrationDeadline: daysFromNow(11, 18),
    locationText: 'St. Anne\'s Church hall, Molete',
    category: 'social', organizationId: church.id,
    capacity: 40, hostedBySenior: true, volunteerEnabled: true, volunteerCapacity: 3
  });

  // later
  await Event.create({
    ...base,
    title: 'Free blood pressure check and chat',
    description: 'Nurses from the community health team will check blood pressure and answer questions. No appointment needed after you register.',
    startsAt: daysFromNow(16, 9), endsAt: daysFromNow(16, 12),
    registrationDeadline: daysFromNow(15, 18),
    locationText: 'St. Anne\'s Church hall, Molete',
    category: 'health', organizationId: church.id,
    capacity: 50
  });

  // past event, for attendance and history
  const past = await Event.create({
    ...base,
    status: 'completed',
    title: 'Morning praise and fellowship',
    description: 'Songs, prayer and breakfast together.',
    startsAt: daysFromNow(-6, 8), endsAt: daysFromNow(-6, 10),
    registrationDeadline: daysFromNow(-7, 18),
    locationText: 'St. Anne\'s Church, Molete',
    category: 'faith', organizationId: church.id,
    capacity: 60
  });

  // registrations
  const reg = (event, senior, type = 'attendee', status = 'registered') =>
    Registration.create({ eventId: event.id, seniorId: senior.id, type, status });

  await reg(walk, seniors[0]);
  await reg(walk, seniors[1]);
  await reg(walk, seniors[2], 'volunteer');
  for (let i = 0; i < 4; i++) await reg(beading, seniors[i + 3]); // 4 of 8 left -> almost full
  for (let i = 0; i < 3; i++) await reg(phones, seniors[i + 4]); // full
  await reg(stories, seniors[0], 'volunteer');
  await reg(past, seniors[0], 'attendee', 'attended');
  await reg(past, seniors[1], 'attendee', 'no_show');
  await reg(past, seniors[2]); // not marked yet

  // a short conversation between two verified seniors
  const chat = [
    [seniors[0], seniors[1], 'Good afternoon Mama. I saw you like stories too. Are you coming to the folktales afternoon?'],
    [seniors[1], seniors[0], 'Good afternoon Baba! Yes, I will try. Will you be the one telling them?'],
    [seniors[0], seniors[1], 'Yes o. Bring your grandchildren if you like.']
  ];
  for (const [from, to, body] of chat) {
    await Message.create({ senderId: from.id, recipientId: to.id, body });
  }

  // welcome guide: transcripts only. Upload the real videos from Admin > Welcome video.
  await OnboardingVideo.create({ language: 'en', transcript: en['onboarding.default_transcript'], uploadedByAdminId: admin.id });
  await OnboardingVideo.create({ language: 'yo', transcript: yo['onboarding.default_transcript'], uploadedByAdminId: admin.id });

  console.log('Seeded. Log in with any of these (password: password123):');
  console.log('  Admin:  08000000001');
  console.log('  Senior: 08030000011 (' + seniors[1].fullName + ', English)');
  console.log('  Senior: 08030000010 (' + seniors[0].fullName + ', Yoruba)');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
