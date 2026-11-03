// Demo seniors: the 10 from the seed plus 10 more. Used by src/services/sampleSeniors.js. All verified (ID approved, phone confirmed) so they can find and message each other.
// photo: file name in public/images/seniors without .jpg, none = man or woman illustration
// log in with the phone number, the code is printed in the terminal while NOTIFY_DRY_RUN=true
const s = (fullName, phone, gender, photo, extra = {}) => ({ fullName, phone, gender, photo, ...extra });

module.exports = [
  // ---- the ten from the seed (same bios and places as src/scripts/seed.js) ----
  s('Babatunde Ogunleye', '+2348030000010', 'male', 'babatunde-ogunleye', {
    area: 'Bodija', lga: 'ibadan-north', language: 'yo',
    bio: 'I spent 34 years as an estate surveyor, measuring land from Bodija to Ogbomoso. These days my mornings start with a walk around the UI ring road, and my evenings end with a game of ayo on the veranda. I love telling my grandchildren how Ibadan looked before the flyovers, and I would enjoy meeting others who remember it too.'
  }),
  s('Adunni Afolabi', '+2348030000011', 'female', 'adunni-afolabi', {
    area: 'Jericho', lga: 'ibadan-north-west',
    bio: 'Grandmother of five and a teacher at heart. I taught English at a secondary school in Jericho for many years, and I still correct grammar on WhatsApp! I sew my own adire dresses, cook egusi for a crowd every Sunday, and nothing makes me happier than a long gist over a cup of tea.'
  }),
  s('Olusegun Adebayo', '+2348030000012', 'male', 'olusegun-adebayo', {
    area: 'Oluyole Estate', lga: 'ibadan-south-west',
    bio: 'Walking keeps me young. I walk around Oluyole Estate every morning at six, rain or shine, and I would love some company on the road. I worked for the Ministry of Works for 30 years, so ask me about any road in Oyo State and I will tell you who built it.'
  }),
  s('Kehinde Oladipo', '+2348030000013', 'male', 'kehinde-oladipo', {
    area: 'Mokola', lga: 'ibadan-north', language: 'yo',
    bio: 'Music has always been my joy. I have sung alto in my church choir in Mokola for over twenty years, and I still practise hymns while I cook. After a long career in banking, I finally have time to learn new things. Beading is next on my list, and I am looking for a patient teacher.'
  }),
  s('Mojisola Akinwale', '+2348030000014', 'female', 'mojisola-akinwale', {
    area: 'Moniya', lga: 'akinyele',
    bio: 'Caring for people is what I know best. I was a nurse at Adeoyo Hospital for 35 years and helped deliver more babies than I can count. Now I enjoy my garden in Moniya, listening to Ebenezer Obey, and helping at health talks where I can share simple tips on blood pressure and staying strong.'
  }),
  s('Tunde Ajayi', '+2348030000015', 'male', 'tunde-ajayi', {
    area: 'Egbeda', lga: 'egbeda',
    bio: 'If you play draughts or ayo, I am looking for you! I worked as an electrical engineer, so I still fix every radio and fan in my compound in Egbeda. I enjoy Saturday football on the radio, a cold glass of zobo, and a friendly argument about the best Nigerian musician of all time.'
  }),
  s('Folake Ogundele', '+2348030000016', 'female', 'folake-ogundele', {
    area: 'Ido', lga: 'ido', language: 'yo',
    bio: 'My kitchen is my happy place. I ran a small catering business in Ido for many years, cooking for weddings, naming ceremonies and church harvests. I still bake chin chin and cakes for church events, and I would love to teach others a few simple recipes they can make at home.'
  }),
  s('Ayodele Olatunji', '+2348030000017', 'male', 'ayodele-olatunji', {
    area: 'Bodija', lga: 'ibadan-north',
    bio: 'Books have been my lifelong friends. I spent my working years as a librarian at the University of Ibadan, and I still read a little every day. I enjoy talking about history, old Yoruba proverbs and the stories behind them, and I am happy to start a small reading group if others are interested.'
  }),
  s('Iyabo Adewale', '+2348030000018', 'female', 'iyabo-adewale', {
    area: 'Jericho', lga: 'ibadan-north-west',
    bio: 'Dugbe market was my home for over forty years, selling fabrics and lace to half of Ibadan. I know how to bargain and I know how to laugh! I love dancing to old juju music, going to owambe parties, and meeting new friends who enjoy good company as much as I do.'
  }),
  s('Gbenga Oyelaran', '+2348030000019', 'male', 'gbenga-oyelaran', {
    area: 'Oluyole Estate', lga: 'ibadan-south-west', language: 'yo',
    bio: 'Plants are my passion. I lectured in agriculture for many years, and today I grow tomatoes, ugu and peppers in a small garden behind my house in Oluyole. Nothing pleases me more than helping someone plant their first seeds. I also enjoy chess and long conversations about farming.'
  }),

  // ---- ten more ----
  s('Bukola Adeyemi', '+2348030000020', 'female', 'bukola-adeyemi', {
    area: 'Challenge', lga: 'ibadan-south-west', language: 'yo',
    bio: 'I retired after 32 years as a matron at a girls’ school in Ibadan, and my house is still full of young people at the weekend. I love Sunday service, good aso-oke and a hearty laugh. I would enjoy outings and cultural events with people who like to talk as much as I do.'
  }),
  s('Titilayo Fashola', '+2348030000021', 'female', 'titilayo-fashola', {
    area: 'Agodi', lga: 'ibadan-north',
    bio: 'I ran a small pharmacy in Agodi for many years, so I still love sharing simple health tips. Now I spend my mornings in the garden and my afternoons with a pot of tea. I would like to meet people for health talks, short walks and good conversation.'
  }),
  s('Yetunde Ajibola', '+2348030000022', 'female', 'yetunde-ajibola', {
    area: 'Sango', lga: 'ibadan-north',
    bio: 'I retired from the Oyo State Secretariat after 30 years. These days I am learning to use my laptop and WhatsApp video calls so I can see my grandchildren abroad. I read a little every day and would love to learn alongside other seniors.'
  }),
  s('Omolara Balogun', '+2348030000023', 'female', 'omolara-balogun', {
    area: 'Alakia', lga: 'egbeda', language: 'yo',
    bio: 'Crochet is my joy. I make hats, bags and baby blankets, and I sold them at the market for years. I am happy to teach anyone who wants to learn, and I enjoy old highlife music and slow evening walks.'
  }),
  s('Abosede Olanrewaju', '+2348030000024', 'female', 'abosede-olanrewaju', {
    area: 'Akanran', lga: 'ona-ara',
    bio: 'I traded in Oja’ba market for 40 years, and laughing is my medicine. I know a proverb for every situation and I love to sit and gist. I would like to join events and make new friends close to Akanran.'
  }),
  s('Adewale Ogunbanjo', '+2348030000025', 'male', 'adewale-ogunbanjo', {
    area: 'Ring Road', lga: 'ibadan-south-west',
    bio: 'I retired as a bank manager and now enjoy a quiet cup of coffee and a good football match on the radio. I am learning to use my phone for more than calls, and I like talking about money matters in plain language. Looking for friends to chat with on a Saturday afternoon.'
  }),
  s('Femi Adeleke', '+2348030000026', 'male', null, {
    area: 'Iwo Road', lga: 'ibadan-north-east',
    bio: 'I coached school football for 35 years and I still walk to the field every morning. Exercise keeps me young, and I would be glad to join walking groups or gentle exercise classes. I also enjoy ayo and a good argument about the national team.'
  }),
  s('Kayode Ogundipe', '+2348030000027', 'male', null, {
    area: 'Samonda', lga: 'ibadan-north',
    bio: 'I taught history at the University of Ibadan, so I can talk about old Ibadan for hours. I enjoy museums, palace visits and anyone with a story from the old days. I would be happy to start a small history and memories group.'
  }),
  s('Rotimi Fagbemi', '+2348030000028', 'male', null, {
    area: 'Moniya', lga: 'akinyele', language: 'yo',
    bio: 'I was a produce buyer and a farmer, and I still grow a little maize and cassava behind my house in Moniya. I like fresh air, ayo, and a long chat over pounded yam. I am looking for good company and events close to Akinyele.'
  }),
  s('Lekan Adesina', '+2348030000029', 'male', null, {
    area: 'Ido', lga: 'ido',
    bio: 'I was a tailor for many years and trained a lot of young apprentices. I still sew in the evenings and know a lot about adire and aso-oke. I love highlife music and would enjoy teaching a small sewing class or joining one.'
  })
];
