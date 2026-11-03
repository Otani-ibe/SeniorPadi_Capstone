// SeniorPadi's own first events, 1 to 4 December 2026. Used by src/scripts/addEvents.js (and by a new site's first start-up).
// Times are Lagos time (WAT, UTC+1). Every one is marked "show first", needs volunteers, and has a limit on places.
//
// The venues are public halls already used elsewhere in the list; confirm each one before the date. There are no flyers yet
// (imageUrl is empty): add each from the admin page when it is made. The doctor, physiotherapist and pension officer are
// invited guests: confirm them too.
const HOST = 'SeniorPadi Community Events';

const ev = (title, category, date, from, to, description, location, area, capacity, volunteerCapacity) => ({
  title, category, description, org: HOST, location, area,
  startsAt: new Date(date + 'T' + from + ':00+01:00'),
  endsAt: new Date(date + 'T' + to + ':00+01:00'),
  capacity, volunteerCapacity,
  featured: true,
  imageUrl: null
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
