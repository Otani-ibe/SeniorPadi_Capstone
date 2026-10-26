// Fills the database with demo data. Wipes existing data first!
// Usage: npm run seed
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { sequelize, User, Organization, Event, Registration, Message, OnboardingVideo } = require('../models');
const en = require('../../locales/en.json');
const yo = require('../../locales/yo.json');

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

  await sequelize.query('TRUNCATE "Translations", "VerificationCodes", "PhoneExchanges", "Attendances", "OnboardingVideos", "Notifications", "ReportHides", "Reports", "Blocks", "Skips", "Messages", "Registrations", "EventInterests", "PasswordResets", "AuditLogs", "Events", "Organizations", "Users" RESTART IDENTITY CASCADE');

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
  // short introductions in their own words
  const bios = [
    'I spent 34 years as an estate surveyor, measuring land from Bodija to Ogbomoso. These days my mornings start with a walk around the UI ring road, and my evenings end with a game of ayo on the veranda. I love telling my grandchildren how Ibadan looked before the flyovers, and I would enjoy meeting others who remember it too.',
    'Grandmother of five and a teacher at heart. I taught English at a secondary school in Jericho for many years, and I still correct grammar on WhatsApp! I sew my own adire dresses, cook egusi for a crowd every Sunday, and nothing makes me happier than a long gist over a cup of tea.',
    'Walking keeps me young. I walk around Oluyole Estate every morning at six, rain or shine, and I would love some company on the road. I worked for the Ministry of Works for 30 years, so ask me about any road in Oyo State and I will tell you who built it.',
    'Music has always been my joy. I have sung alto in my church choir in Mokola for over twenty years, and I still practise hymns while I cook. After a long career in banking, I finally have time to learn new things. Beading is next on my list, and I am looking for a patient teacher.',
    'Caring for people is what I know best. I was a nurse at Adeoyo Hospital for 35 years and helped deliver more babies than I can count. Now I enjoy my garden in Moniya, listening to Ebenezer Obey, and helping at health talks where I can share simple tips on blood pressure and staying strong.',
    'If you play draughts or ayo, I am looking for you! I worked as an electrical engineer, so I still fix every radio and fan in my compound in Egbeda. I enjoy Saturday football on the radio, a cold glass of zobo, and a friendly argument about the best Nigerian musician of all time.',
    'My kitchen is my happy place. I ran a small catering business in Ido for many years, cooking for weddings, naming ceremonies and church harvests. I still bake chin chin and cakes for church events, and I would love to teach others a few simple recipes they can make at home.',
    'Books have been my lifelong friends. I spent my working years as a librarian at the University of Ibadan, and I still read a little every day. I enjoy talking about history, old Yoruba proverbs and the stories behind them, and I am happy to start a small reading group if others are interested.',
    'Dugbe market was my home for over forty years, selling fabrics and lace to half of Ibadan. I know how to bargain and I know how to laugh! I love dancing to old juju music, going to owambe parties, and meeting new friends who enjoy good company as much as I do.',
    'Plants are my passion. I lectured in agriculture for many years, and today I grow tomatoes, ugu and peppers in a small garden behind my house in Oluyole. Nothing pleases me more than helping someone plant their first seeds. I also enjoy chess and long conversations about farming.'
  ];
  // neighbourhood and its local government area
  const places = [
    ['Bodija', 'ibadan-north'], ['Jericho', 'ibadan-north-west'], ['Oluyole Estate', 'ibadan-south-west'],
    ['Mokola', 'ibadan-north'], ['Moniya', 'akinyele'], ['Egbeda', 'egbeda'], ['Ido', 'ido'],
    ['Bodija', 'ibadan-north'], ['Jericho', 'ibadan-north-west'], ['Oluyole Estate', 'ibadan-south-west']
  ];
  // Kehinde and Ayodele are left blank, to show the neutral picture
  const genders = ['male', 'female', 'male', null, 'female', 'male', 'female', null, 'female', 'male'];
  const seniors = [];
  for (let i = 0; i < names.length; i++) {
    seniors.push(await User.create({
      fullName: names[i],
      phone: '+23480300000' + String(i + 10),
      email: i < 4 ? 'senior' + (i + 1) + '@seniorpadi.test' : null,
      passwordHash: password,
      ageDeclared: true,
      gender: genders[i],
      preferredLanguage: i % 3 === 0 ? 'yo' : 'en',
      reminderDaysBefore: (i % 3) + 1,
      area: places[i][0],
      lga: places[i][1],
      // first 6 are verified for Find Seniors, number 7 is waiting for an ID check
      verificationStatus: i < 6 ? 'approved' : (i === 6 ? 'pending' : 'unverified'),
      bio: bios[i],
      onboardingSeenAt: i === 9 ? null : new Date(), // the last one hasn't seen the welcome guide
      // everyone's phone is confirmed except Ayodele (08030000017), to show the code step
      phoneVerifiedAt: i === 7 ? null : new Date(),
      emailVerifiedAt: i < 4 && i !== 7 ? new Date() : null
    }));
  }

  // partner organisations. Contact details are added by staff once confirmed.
  const orgNames = [
    'Dynamo Gym and Fitness Centre',
    'Ozone Ateliers',
    'Chief Tony Anenih Geriatric Centre, UCH',
    'Royal Spices Academy',
    'Ona Ara Local Government',
    'Sheda House',
    'Oyo State Cultural Centre',
    'St. David’s Anglican Cathedral, Kudeti',
    'Oyo State Library Board',
    'BeadMaker Smilescreation',
    'iFitness Ibadan',
    'Mobeth Couture',
    'Nuela’s Cuisine Academy',
    'University of Ibadan Staff School',
    'Premier Hotel Ibadan',
    'Department of Art and Design, The Polytechnic, Ibadan',
    'St. Peter’s Anglican Cathedral, Aremo',
    'University of Ibadan Botanical Garden',
    'Ibadan South-East Local Government',
    'University of Ibadan Zoological Garden'
  ];
  const orgs = {};
  for (const name of orgNames) {
    orgs[name] = await Organization.create({ name, createdByAdminId: admin.id });
  }

  // a Lagos date and time (Lagos is UTC+1)
  const at = (y, m, d, hour, min = 0) => new Date(Date.UTC(y, m - 1, d, hour - 1, min));

  // [category, title, description, partner, venue, area, [y, m, d], start hour, end hour, capacity, volunteers]
  const list = [
    ['fitness', 'Workout Session for a Stronger Body', 'Join a trainer for gentle exercises that improve strength, balance and flexibility.', 'Dynamo Gym and Fitness Centre', 'Ashi, Bodija, Ibadan', 'ibadan-north', [2026, 12, 5], 8, 9.5, 25],
    ['skills', 'Learn the Basics of Fashion Design', 'Learn to take simple body measurements, choose fabrics and sketch your own outfit ideas with a fashion designer.', 'Ozone Ateliers', 'Egbeda Local Government Secretariat, Egbeda, Ibadan', 'egbeda', [2026, 12, 6], 10, 12, 20],
    ['health', 'Blood Pressure and Blood Sugar Screening', 'Get basic health checks and learn simple ways to monitor your health.', 'Chief Tony Anenih Geriatric Centre, UCH', 'UCH, Agodi, Ibadan', 'ibadan-north', [2026, 12, 8], 9, 13, 60, 4],
    ['learning', 'Learn to Bake Simple Cakes and Pastries', 'Learn basic baking techniques and decorate your own small cake.', 'Royal Spices Academy', 'Oluyole Industrial Estate, Ibadan', 'ibadan-south-west', [2026, 12, 10], 11, 13, 20],
    ['charity', 'Relief Materials for Senior Citizens', 'Registered seniors receive food items and essential household supplies, including rice, beans, garri and toiletries.', 'Ona Ara Local Government', 'Ona Ara Local Government Secretariat, Akanran, Ibadan', 'ona-ara', [2026, 12, 12], 10, 14, 100, 6],
    ['creativity', 'Learn Painting and Create Your Own Artwork', 'Learn basic painting techniques and create an artwork to take home.', 'Sheda House', 'Mapo Hall, Mapo Hill, Ibadan', 'ibadan-south-east', [2026, 12, 15], 11, 13, 20],
    ['social', 'Ayo Olopon Games and Social Afternoon', 'Play Ayo Olopon with other seniors, learn from fellow players and enjoy refreshments together.', 'Oyo State Cultural Centre', 'Cultural Centre, Mokola, Ibadan', 'ibadan-north', [2026, 12, 17], 15, 18, 30],
    ['faith', 'Christmas Hymns, Prayer and Fellowship', 'Sing familiar hymns, pray together and share Christmas fellowship with other seniors.', 'St. David’s Anglican Cathedral, Kudeti', 'St. David’s Cathedral, Kudeti, Ibadan', 'ibadan-south-east', [2026, 12, 19], 16, 18, 60],
    ['learning', 'Read at the State Library with Other Seniors', 'Spend a quiet morning reading books and newspapers in the library, then sit together and talk about what you read.', 'Oyo State Library Board', 'Oyo State Library, Ibadan', 'ibadan-north-west', [2026, 12, 22], 10, 12, 20],
    ['creativity', 'Learn to Make Beaded Jewellery', 'Learn to make simple bracelets and necklaces using colourful beads.', 'BeadMaker Smilescreation', 'Ido Local Government Secretariat, Ido, Ibadan', 'ido', [2026, 12, 29], 11, 13, 20],
    ['fitness', 'Low-Impact Aerobics for Seniors', 'Join a guided movement session designed to improve mobility and stamina, with seated exercise options.', 'iFitness Ibadan', 'iFitness, The Palms Mall, Ring Road, Ibadan', 'ibadan-south-west', [2027, 1, 5], 8, 9.5, 25],
    ['skills', 'Learn to Make Your Own Fashion Accessories', 'Learn to make simple fabric headbands, pouches or reusable shopping bags.', 'Mobeth Couture', 'Akinyele Local Government Secretariat, Moniya, Ibadan', 'akinyele', [2027, 1, 8], 10, 12, 20],
    ['health', 'Healthy Eating After 60', 'Learn about balanced meals, hydration and affordable Nigerian foods that support healthy ageing.', 'Nuela’s Cuisine Academy', '35 Osunaira Junction, Ashi Road, Old Bodija, Ibadan', 'ibadan-north', [2027, 1, 10], 11, 13, 25],
    ['learning', 'Volunteer to Read with Primary School Pupils', 'Read stories with children, practise Yoruba proverbs and share useful life lessons.', 'University of Ibadan Staff School', 'Staff School, University of Ibadan', 'ibadan-north', [2027, 1, 12], 10, 12, 15],
    ['social', 'Seniors’ Lunch and Friendship Gathering', 'Enjoy a shared meal, meet other seniors and spend an afternoon talking and making friends.', 'Premier Hotel Ibadan', 'Premier Hotel, Mokola Hill, Ibadan', 'ibadan-north', [2027, 1, 15], 13, 15.5, 40],
    ['creativity', 'Learn to Make Pottery and Clay Decorations', 'Learn to shape clay into small bowls, pots or decorative items.', 'Department of Art and Design, The Polytechnic, Ibadan', 'The Polytechnic, Ibadan, Sango', 'ibadan-north', [2027, 1, 17], 11, 13, 15],
    ['faith', 'Bible Study and Life Experiences Sharing', 'Discuss a Bible passage, share personal experiences and encourage one another through faith.', 'St. Peter’s Anglican Cathedral, Aremo', 'St. Peter’s Cathedral, Aremo, Ibadan', 'ibadan-north-east', [2027, 1, 19], 16, 18, 40],
    ['skills', 'Learn to Grow Vegetables at Home', 'Learn how to plant and care for vegetables and herbs in containers at home.', 'University of Ibadan Botanical Garden', 'Botanical Garden, University of Ibadan', 'ibadan-north', [2027, 1, 22], 9, 11, 25],
    ['charity', 'Haircuts and Personal Grooming for Seniors', 'Receive a haircut or simple grooming service from volunteer professionals.', 'Ibadan South-East Local Government', 'Ibadan South-East Local Government Secretariat, Mapo, Ibadan', 'ibadan-south-east', [2027, 1, 26], 10, 14, 40],
    ['social', 'Explore Ibadan Zoo with Fellow Seniors', 'Enjoy a group visit to see the animals, explore the grounds at a comfortable pace and socialise with fellow seniors.', 'University of Ibadan Zoological Garden', 'Zoological Garden, University of Ibadan', 'ibadan-north', [2027, 1, 30], 9, 12, 30, 4]
  ];

  // events that come with a photo (in public/images/events)
  const photos = {
    'Workout Session for a Stronger Body': '/images/events/workout-stronger-body.jpg',
    'Low-Impact Aerobics for Seniors': '/images/events/low-impact-aerobics.jpg',
    'Blood Pressure and Blood Sugar Screening': '/images/events/health-screening.jpg',
    'Learn to Bake Simple Cakes and Pastries': '/images/events/baking.jpg',
    'Learn the Basics of Fashion Design': '/images/events/fashion-design.jpg',
    'Learn Painting and Create Your Own Artwork': '/images/events/painting.jpg',
    'Relief Materials for Senior Citizens': '/images/events/relief-materials.jpg'
  };

  const events = [];
  for (const [category, title, description, partner, locationText, area, [y, m, d], start, end, capacity, volunteers] of list) {
    events.push(await Event.create({
      createdByAdminId: admin.id,
      status: 'published',
      category, title, description, locationText, area, capacity,
      imageUrl: photos[title] || null,
      organizationId: orgs[partner].id,
      startsAt: at(y, m, d, Math.floor(start), (start % 1) * 60),
      endsAt: at(y, m, d, Math.floor(end), (end % 1) * 60),
      registrationDeadline: at(y, m, d - 1, 18), // 6 pm the day before
      volunteerEnabled: Boolean(volunteers),
      volunteerCapacity: volunteers || null
    }));
  }

  // a few registrations, so My tickets and the admin pages have something in them
  const reg = (event, senior, type = 'attendee') =>
    Registration.create({ eventId: event.id, seniorId: senior.id, type, status: 'registered' });
  await reg(events[0], seniors[0]);
  await reg(events[2], seniors[1]);
  await reg(events[4], seniors[2], 'volunteer');
  await reg(events[6], seniors[0]);

  // a short conversation between two verified seniors
  const chat = [
    [seniors[0], seniors[1], 'Good afternoon Mama. I saw you like stories too. Are you coming to the Ayo Olopon afternoon?'],
    [seniors[1], seniors[0], 'Good afternoon Baba! Yes, I will try. Will you teach me?'],
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
  console.log('  Senior: 08030000017 (' + seniors[7].fullName + ', phone not confirmed yet)');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
