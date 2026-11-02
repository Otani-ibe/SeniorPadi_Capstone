// The demo seniors: the 10 from the seed, plus 10 more. Used by src/services/sampleSeniors.js.
// Every one is verified (ID approved, phone confirmed) so they can all find and message each other.
// photo: the file name in public/images/seniors (without .jpg). No photo = the man or woman illustration is shown.
// Log in with the phone number: the code is printed in the terminal where the app runs (while NOTIFY_DRY_RUN=true).
const s = (fullName, phone, gender, photo, extra = {}) => ({ fullName, phone, gender, photo, ...extra });

module.exports = [
  // ---- the ten from the seed (their bios and places come from the seed) ----
  s('Babatunde Ogunleye', '+2348030000010', 'male', 'babatunde-ogunleye'),
  s('Adunni Afolabi', '+2348030000011', 'female', 'adunni-afolabi'),
  s('Olusegun Adebayo', '+2348030000012', 'male', 'olusegun-adebayo'),
  s('Kehinde Oladipo', '+2348030000013', 'male', 'kehinde-oladipo'),
  s('Mojisola Akinwale', '+2348030000014', 'female', 'mojisola-akinwale'),
  s('Tunde Ajayi', '+2348030000015', 'male', 'tunde-ajayi'),
  s('Folake Ogundele', '+2348030000016', 'female', 'folake-ogundele'),
  s('Ayodele Olatunji', '+2348030000017', 'male', 'ayodele-olatunji'),
  s('Iyabo Adewale', '+2348030000018', 'female', 'iyabo-adewale'),
  s('Gbenga Oyelaran', '+2348030000019', 'male', 'gbenga-oyelaran'),

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
