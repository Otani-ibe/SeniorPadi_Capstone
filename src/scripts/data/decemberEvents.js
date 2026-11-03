// SeniorPadi's own first events, 1 to 4 December 2026. Used by src/scripts/addEvents.js (and by a new site's first start-up).
// Times are Lagos time (WAT, UTC+1). Every one is marked "show first", needs volunteers, and has a limit on places.
//
// The venues are public halls already used elsewhere in the list; confirm each one before the date. The flyers are in
// public/images/events/december/ (1200 x 900). The doctor, physiotherapist and pension officer are invited guests: confirm them too.
const HOST = 'SeniorPadi Community Events';

// each event's flyer, and what it says for readers who cannot see it (screen readers say this instead of showing the picture)
const FLYERS = {
  'Ask the Doctor: The Questions You Are Shy to Ask': ['01-ask-the-doctor.jpg', 'Flyer: Ask the Doctor. Topic: the questions you are shy to ask. Tuesday 1 December, 10:00 AM to 12:30 PM. Senior Citizen Palace, Bashorun Estate, Akobo, Ibadan. 50 seniors and 6 volunteers. A smiling doctor with a stethoscope. Sign up on SeniorPadi.'],
  'Dance Like It\'s 1975: Highlife and Juju Afternoon': ['02-dance-like-its-1975.jpg', 'Flyer: Dance like it\'s 1975, a highlife and juju afternoon. Come in your best clothes and bring a friend. Tuesday 1 December, 3:00 to 6:00 PM, Mapo Hall, Ibadan. Register by 6:00 PM on Monday 30 November. An illustration of three people dancing. Sign up on SeniorPadi.'],
  'Retired, Not Retired: Pension, Scams and Your Money': ['03-retired-not-retired.jpg', 'Flyer: Retired, not retired. Pension, scams and your money. Wednesday 2 December, 10:00 AM to 12:30 PM, Cultural Centre, Mokola, Ibadan. A smiling older man in a flat cap. Sign up on SeniorPadi.'],
  'Fall-Proof Your Home': ['04-fall-proof-your-home.jpg', 'Flyer: A morning session. Fall-proof your home. Thursday 3 December, 9:30 to 11:30 AM, Senior Citizen Palace, Bashorun Estate, Akobo, Ibadan. A smiling older woman tying her trainer. Sign up on SeniorPadi.'],
  'Ayo Olopon Showdown: Grandparents vs Grandchildren': ['05-ayo-olopon-showdown.jpg', 'Flyer: Ayo Olopon Showdown, grandparents versus grandchildren. Who plays it better? Come and settle it. Thursday 3 December, 12:30 to 3:30 PM, Cultural Centre, Mokola, Ibadan. A group of elders and young people posing inside an old television. Sign up on SeniorPadi.'],
  'Sing It Like the Old Days: Karaoke for Elders': ['06-sing-it-like-the-old-days.jpg', 'Flyer: Karaoke for elders. Sing it like the old days. Pick your song. Take the mic. Thursday 3 December, 4:30 to 7:00 PM, Mapo Hall, Ibadan. A smiling older woman holding a radio cassette player. Sign up on SeniorPadi.'],
  'Teach Pupils in Primary School Day': ['07-teach-pupils-primary-school-day.jpg', 'Flyer: Volunteer day for elders. Teach pupils in primary school day. Friday 4 December, 9:00 AM to 12:00 noon, Ibadan North. We will text you the school before the day. Smiling primary school pupils and a teacher. Sign up on SeniorPadi.']
};

const ev = (title, category, date, from, to, description, location, area, capacity, volunteerCapacity) => ({
  title, category, description, org: HOST, location, area,
  startsAt: new Date(date + 'T' + from + ':00+01:00'),
  endsAt: new Date(date + 'T' + to + ':00+01:00'),
  capacity, volunteerCapacity,
  featured: true,
  imageUrl: '/images/events/december/' + FLYERS[title][0],
  imageAlt: FLYERS[title][1]
});

module.exports = [
  // ---------- Tuesday 1 December ----------
  ev('Ask the Doctor: The Questions You Are Shy to Ask', 'health', '2026-12-01', '10:00', '12:30',
    'A volunteer doctor answers the questions many of us are too shy to ask: forgetfulness and memory, sleep, blood pressure, prostate and women\'s health, aches that will not go away, and loneliness. Write your question on a card with no name and it is read out and answered, or ask in private after the talk. There are no tests and no treatment here, only honest answers and advice on where to get help. In Yoruba and English, with seats for everyone and tea afterwards. Volunteers are needed to welcome people, hand out question cards, translate and walk elders to their seats.',
    'Senior Citizen Palace, Bashorun Estate, Akobo, Ibadan', 'ibadan-north', 50, 6),
  ev('Dance Like It\'s 1975: Highlife and Juju Afternoon', 'social', '2026-12-01', '15:00', '18:00',
    'An afternoon of live highlife and juju music, the songs of our youth. Dance on the floor or stay in your seat and clap along: nobody has to dance to join, and there is a chair for everyone. There is a request table for your favourite song and a prize for the best old-school move. Water and light refreshments are served. Come in your best clothes and bring a friend. Volunteers are needed to welcome guests, help with seating and refreshments, and walk elders to the dance floor and back.',
    'Mapo Hall, Ibadan', 'ibadan-south-east', 60, 8),

  // ---------- Wednesday 2 December ----------
  ev('Retired, Not Retired: Pension, Scams and Your Money', 'learning', '2026-12-02', '10:00', '12:30',
    'A practical morning on your pension, your savings and staying safe from money scams. Learn how to check that your pension is being paid, what a real bank or pension office will never ask you for, how to spot fake alert messages and phone scams, and what to do if you have already been tricked. Bring any suspicious message or phone number you have received and we will look at it together. Questions are welcome in Yoruba or English. Volunteers are needed to register guests, sit one-to-one with seniors who need help, and write down questions.',
    'Cultural Centre, Mokola, Ibadan', 'ibadan-north', 40, 4),

  // ---------- Thursday 3 December ----------
  ev('Fall-Proof Your Home', 'health', '2026-12-03', '09:30', '11:30',
    'A physiotherapist shows simple, low-cost ways to prevent falls at home: better lighting, safe floors and bathrooms, grip rails and mats, the right footwear, and slow chair exercises that improve balance. Practise each one in the room, and take home a short checklist to go through your own house with your family. Family members and carers are welcome to come too. Volunteers are needed to help with seating, hold up the demonstrations and give out the checklist.',
    'Senior Citizen Palace, Bashorun Estate, Akobo, Ibadan', 'ibadan-north', 30, 4),
  ev('Ayo Olopon Showdown: Grandparents vs Grandchildren', 'social', '2026-12-03', '12:30', '15:30',
    'Teams of one grandparent and one grandchild play ayo (olopon) on shared boards. The elders explain the rules, and the children find out how hard it is to beat them. There is a friendly round for everyone, a final for the best teams, and prizes for the winners and for the best sportsmanship. Snacks and water are served. No grandchild? Come anyway: you will be paired with a young player. Volunteers are needed as referees, to set up the boards and to pair up people who come alone.',
    'Cultural Centre, Mokola, Ibadan', 'ibadan-north', 40, 6),
  ev('Sing It Like the Old Days: Karaoke for Elders', 'creativity', '2026-12-03', '16:30', '19:00',
    'Karaoke with the words on a big screen, for the songs everyone knows by heart: Yoruba classics, highlife, juju, gospel and old favourites. Sing alone, sing in a group, or just hum along from your seat. Give your song request at the door. The microphone is wiped between singers, and there is seating for all, with water and light refreshments. Volunteers are needed to run the song list and the screen, look after the microphones and help with seating.',
    'Mapo Hall, Ibadan', 'ibadan-south-east', 50, 5),

  // ---------- Friday 4 December ----------
  ev('Teach Pupils in Primary School Day', 'learning', '2026-12-04', '09:00', '12:00',
    'Retired teachers, nurses, farmers, traders, tailors: if you have a skill or a story, spend a morning teaching a short lesson to primary school pupils. It could be reading, counting, history, a trade skill, good manners or a health tip. You choose your lesson and a volunteer helps you plan 20 minutes. The class teacher stays in the room, and seats and water are provided. The school is shared by text message a few days before, and a volunteer can walk or ride with you. Volunteers are needed to escort seniors, help prepare lessons and support the class.',
    'A primary school in Ibadan North (the school is shared by text before the day)', 'ibadan-north', 20, 6)
];
