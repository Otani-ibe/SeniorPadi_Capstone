const fs = require('fs');
const path = require('path');
const models = require('../src/models');
const { User } = models;
const social = require('../src/services/social');
const { ensureSampleSeniors } = require('../src/services/sampleSeniors');
const data = require('../src/scripts/data/seniors');
const { resetDb, makeUser, sequelize } = require('./helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

test('the demo seniors list is 20 people, each phone once, and every picture file exists', () => {
  expect(data).toHaveLength(20);
  expect(new Set(data.map((s) => s.phone)).size).toBe(20);
  expect(new Set(data.map((s) => s.fullName)).size).toBe(20);
  for (const s of data) {
    expect(['male', 'female']).toContain(s.gender);
    expect(s.phone).toMatch(/^\+2348030000\d{3}$/);
    if (s.photo) expect(fs.existsSync(path.join(__dirname, '../public/images/seniors', s.photo + '.jpg'))).toBe(true);
  }
  for (const s of data) {
    expect(s.bio.length).toBeGreaterThan(100);
    expect(s.area && s.lga).toBeTruthy();
  }
  // sixteen have a picture, four do not
  expect(data.filter((s) => !s.photo).map((s) => s.fullName)).toEqual(['Femi Adeleke', 'Kayode Ogundipe', 'Rotimi Fagbemi', 'Lekan Adesina']);
});

test('every demo senior is verified and can message every other one', async () => {
  const result = await ensureSampleSeniors(models);
  expect(result.created).toBe(20);
  const seniors = await User.findAll({ where: { role: 'senior' } });
  expect(seniors).toHaveLength(20);
  for (const s of seniors) {
    expect(s.verificationStatus).toBe('approved');
    expect(s.contactVerified()).toBe(true);
  }
  for (const a of seniors) {
    for (const b of seniors) {
      if (a.id !== b.id) expect(await social.canMessage(a, b)).toBe(true);
    }
  }
});

test('running it again adds nothing, and never replaces a picture or bio someone set themselves', async () => {
  await ensureSampleSeniors(models);
  const mine = await User.findOne({ where: { phone: '+2348030000020' } });
  await mine.update({ profilePictureUrl: 'https://example.test/me.jpg', bio: 'Written by me' });
  const again = await ensureSampleSeniors(models);
  expect(again.created).toBe(0);
  expect(await User.count({ where: { role: 'senior' } })).toBe(20);
  const same = await User.findByPk(mine.id);
  expect(same.profilePictureUrl).toBe('https://example.test/me.jpg');
  expect(same.bio).toBe('Written by me');
});

test('seed seniors who were pending or unverified become verified, and a real person is left alone', async () => {
  const pending = await makeUser({ fullName: 'Folake Ogundele', phone: '+2348030000016', verificationStatus: 'pending', phoneVerifiedAt: null });
  const real = await makeUser({ fullName: 'A Real Person', verificationStatus: 'pending' });
  await ensureSampleSeniors(models);
  const fixed = await User.findByPk(pending.id);
  expect(fixed.verificationStatus).toBe('approved');
  expect(fixed.phoneVerifiedAt).not.toBeNull();
  expect(fixed.profilePictureUrl).toBe('/images/seniors/folake-ogundele.jpg');
  expect((await User.findByPk(real.id)).verificationStatus).toBe('pending');
});

test('accounts that already exist without a bio or place get them, and what someone wrote is kept', async () => {
  await User.create({ fullName: data[0].fullName, phone: data[0].phone, passwordHash: 'x', ageDeclared: true, gender: 'male' });
  await User.create({ fullName: data[1].fullName, phone: data[1].phone, passwordHash: 'x', ageDeclared: true, gender: 'female', bio: 'My own words.', area: 'Dugbe' });
  await ensureSampleSeniors(models, { log: () => {} });
  const first = await User.findOne({ where: { phone: data[0].phone } });
  expect(first).toMatchObject({ bio: data[0].bio, area: data[0].area, lga: data[0].lga });
  const second = await User.findOne({ where: { phone: data[1].phone } });
  expect(second).toMatchObject({ bio: 'My own words.', area: 'Dugbe', lga: data[1].lga });
});
