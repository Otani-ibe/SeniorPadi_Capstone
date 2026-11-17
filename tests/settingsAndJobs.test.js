// My settings (details, profile picture, delete account) and the scheduled jobs.
const fs = require('fs');
const request = require('supertest');

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const cron = require('node-cron');

const app = require('../src/app');
const { User, Event, Registration } = require('../src/models');
const cloud = require('../src/services/cloudinary');
const jobs = require('../src/services/cron');
const { lastCodeForTests } = require('../src/services/verification');
const { resetDb, makeUser, makeEvent, csrfFrom, signIn, sequelize, DAY } = require('./helpers');

const PHONE = '08031000101';
const made = [];
let agent;
let user;

async function csrf(path = '/settings') {
  const page = await agent.get(path);
  return csrfFrom(page.text);
}

// the token is fetched before the request is created, otherwise supertest closes the request's server too early
async function postForm(url, fields, tokenPage = '/settings') {
  const _csrf = fields._csrf === false ? undefined : await csrf(tokenPage);
  const { _csrf: ignore, ...rest } = fields;
  return agent.post(url).type('form').send(_csrf ? { _csrf, ...rest } : rest);
}

// the old picture is removed in the background, so wait until it is gone (up to 3 seconds)
async function waitUntilGone(file) {
  for (let i = 0; i < 30 && fs.existsSync(file); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeEach(async () => {
  await resetDb();
  const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_SECRET'];
  keys.forEach((k) => delete process.env[k]); // pictures are saved on this computer
  user = await makeUser({ phone: '+234' + PHONE.slice(1), fullName: 'Ade Bello' });
  agent = request.agent(app);
  await signIn(agent, PHONE);
});

afterEach(() => jest.clearAllMocks());

afterAll(async () => {
  made.forEach((id) => { const p = cloud.localPath(id); if (p) fs.rmSync(p, { force: true }); });
  await sequelize.close();
});

describe('settings', () => {
  test('the page opens for a signed-in senior and not for a visitor', async () => {
    expect((await agent.get('/settings')).status).toBe(200);
    const visitor = await request(app).get('/settings');
    expect(visitor.status).toBe(302);
    expect(visitor.headers.location).toBe('/login');
  });

  test('saving details updates the account', async () => {
    const res = await postForm('/settings', {
      email: '  Ade@Example.com ', preferredLanguage: 'yo', reminderDaysBefore: '7',
      remindersEnabled: 'yes', showOnlineStatus: 'no', area: ' Bodija ', gender: 'male', lga: 'ibadan-north', bio: '  Retired teacher  '
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings');
    await user.reload();
    expect(user.email).toBe('ade@example.com');
    expect(user.preferredLanguage).toBe('yo');
    expect(user.reminderDaysBefore).toBe(7);
    expect(user.remindersEnabled).toBe(true);
    expect(user.showOnlineStatus).toBe(false);
    expect(user.area).toBe('Bodija');
    expect(user.gender).toBe('male');
    expect(user.lga).toBe('ibadan-north');
    expect(user.bio).toBe('Retired teacher');
  });

  test('odd values fall back to safe ones', async () => {
    await user.update({ lga: 'oluyole' });
    await postForm('/settings', {
      email: '', preferredLanguage: 'fr', reminderDaysBefore: '40', remindersEnabled: 'no',
      gender: 'robot', lga: 'not-a-real-area', bio: 'x'.repeat(900)
    });

    await user.reload();
    expect(user.preferredLanguage).toBe('en');
    expect(user.reminderDaysBefore).toBe(2);
    expect(user.remindersEnabled).toBe(false);
    expect(user.gender).toBeNull();
    expect(user.lga).toBe('oluyole'); // unchanged
    expect(user.bio.length).toBe(500);
    expect(user.email).toBeNull();
  });

  test('a bad email is refused and nothing is saved', async () => {
    const res = await postForm('/settings', { email: 'not-an-email', bio: 'changed' });
    expect(res.status).toBe(400);
    await user.reload();
    expect(user.bio).not.toBe('changed');
  });

  test('an email already used by someone else is refused', async () => {
    await makeUser({ email: 'taken@example.com' });
    const res = await postForm('/settings', { email: 'taken@example.com' });
    expect(res.status).toBe(400);
    await user.reload();
    expect(user.email).toBeNull();
  });

  test('changing the email clears its confirmation, keeping it keeps it', async () => {
    const confirmed = new Date();
    await user.update({ email: 'ade@example.com', emailVerifiedAt: confirmed });

    await postForm('/settings', { email: 'ade@example.com' });
    await user.reload();
    expect(user.emailVerifiedAt).not.toBeNull();

    await postForm('/settings', { email: 'new@example.com' });
    await user.reload();
    expect(user.emailVerifiedAt).toBeNull();
  });

  test('a form without the CSRF token is refused', async () => {
    const res = await postForm('/settings', { _csrf: false, email: 'x@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('profile picture', () => {
  const upload = async (build) => {
    const token = await csrf();
    return build(agent.post('/settings/profile-picture?_csrf=' + token));
  };

  test('a picture is saved and the account points to it', async () => {
    const res = await upload((r) => r.attach('picture', Buffer.from('png-bytes'), { filename: 'me.png', contentType: 'image/png' }));

    expect(res.status).toBe(302);
    await user.reload();
    expect(user.profilePictureUrl).toMatch(/^\/uploads\/profile\//);
    made.push(user.profilePicturePublicId);
    expect(fs.existsSync(cloud.localPath(user.profilePicturePublicId))).toBe(true);
  });

  test('a new picture replaces the old one, and the old file is removed', async () => {
    await upload((r) => r.attach('picture', Buffer.from('one'), { filename: 'a.png', contentType: 'image/png' }));
    await user.reload();
    const first = user.profilePicturePublicId;
    made.push(first);

    await upload((r) => r.attach('picture', Buffer.from('two'), { filename: 'b.jpg', contentType: 'image/jpeg' }));
    await user.reload();
    made.push(user.profilePicturePublicId);
    await waitUntilGone(cloud.localPath(first));

    expect(user.profilePicturePublicId).not.toBe(first);
    expect(fs.existsSync(cloud.localPath(first))).toBe(false);
  });

  test('a file that is not a picture is refused', async () => {
    const res = await upload((r) => r.attach('picture', Buffer.from('%PDF'), { filename: 'x.pdf', contentType: 'application/pdf' }));
    expect(res.status).toBe(302);
    await user.reload();
    expect(user.profilePictureUrl).toBeNull();
  });

  test('a picture over 8 MB is refused', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024 + 10, 1);
    await upload((r) => r.attach('picture', big, { filename: 'big.png', contentType: 'image/png' }));
    await user.reload();
    expect(user.profilePictureUrl).toBeNull();
  });

  test('sending no file changes nothing', async () => {
    const res = await upload((r) => r.field('note', 'nothing attached'));
    expect(res.status).toBe(302);
    await user.reload();
    expect(user.profilePictureUrl).toBeNull();
  });

  test('a storage failure is reported and nothing is saved', async () => {
    jest.spyOn(cloud, 'uploadBuffer').mockRejectedValue(new Error('disk full'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await upload((r) => r.attach('picture', Buffer.from('png'), { filename: 'me.png', contentType: 'image/png' }));

    expect(res.status).toBe(302);
    await user.reload();
    expect(user.profilePictureUrl).toBeNull();
    jest.restoreAllMocks();
  });
});

describe('delete account', () => {
  const askForCode = async () => {
    const res = await postForm('/account/delete/code', {}, '/account/delete');
    expect(res.headers.location).toBe('/account/delete?sent=1');
    return lastCodeForTests(user.id);
  };

  test('the page opens for a senior and explains that a code will be texted, not a password', async () => {
    const page = await agent.get('/account/delete');
    expect(page.status).toBe(200);
    expect(page.text).toContain(PHONE); // their number is shown
    expect(page.text).not.toContain('type="password"');
  });

  test('a wrong code does not delete anything', async () => {
    await askForCode();
    const res = await postForm('/account/delete', { code: '000000' }, '/account/delete');
    expect(res.status).toBe(400);
    expect(await User.findByPk(user.id)).not.toBeNull();
  });

  test('no code asked for means nothing can be deleted', async () => {
    const res = await postForm('/account/delete', { code: '123456' }, '/account/delete');
    expect(res.status).toBe(400);
    expect(await User.findByPk(user.id)).not.toBeNull();
  });

  test('the right code frees upcoming places and erases the person', async () => {
    const event = await makeEvent();
    const reg = await Registration.create({ eventId: event.id, seniorId: user.id, type: 'attendee' });
    await user.update({ email: 'ade@example.com', bio: 'Retired teacher', area: 'Bodija', gender: 'male' });
    const code = await askForCode();

    const res = await postForm('/account/delete', { code }, '/account/delete');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(await User.findByPk(user.id)).toBeNull(); // hidden from every list
    await reg.reload();
    expect(reg.status).toBe('cancelled');

    // the row stays for the records, but holds nothing about the person (NDPA 2023, s. 34)
    const row = await User.findByPk(user.id, { paranoid: false });
    expect(row.fullName).toBe('Deleted member');
    expect(row.phone).not.toContain('803100010');
    expect(row.phone.startsWith('+')).toBe(false);
    ['email', 'bio', 'area', 'lga', 'gender', 'profilePictureUrl', 'latitude', 'longitude'].forEach((k) => expect(row[k]).toBeNull());
  });

  test('the old number can sign up again after deleting', async () => {
    const code = await askForCode();
    await postForm('/account/delete', { code }, '/account/delete');
    const again = await makeUser({ phone: '+234' + PHONE.slice(1), fullName: 'Ade Bello' });
    expect(again.id).not.toBe(user.id);
  });
});

describe('scheduled jobs', () => {
  test('finished events are marked completed, upcoming and cancelled ones are left alone', async () => {
    const past = await makeEvent({
      startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY), registrationDeadline: new Date(Date.now() - 3 * DAY)
    });
    const upcoming = await makeEvent();
    const cancelled = await makeEvent({
      status: 'cancelled', startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY), registrationDeadline: new Date(Date.now() - 3 * DAY)
    });

    expect(await jobs.completeFinishedEvents()).toBe(1);

    expect((await Event.findByPk(past.id)).status).toBe('completed');
    expect((await Event.findByPk(upcoming.id)).status).toBe('published');
    expect((await Event.findByPk(cancelled.id)).status).toBe('cancelled');
  });

  test('startJobs schedules the 8 am reminders, the hourly clean-up and the 9 am ID expiry in Lagos time', () => {
    jobs.startJobs();

    const schedules = cron.schedule.mock.calls.map((c) => [c[0], c[2]]);
    expect(schedules).toEqual([
      ['0 8 * * *', { timezone: 'Africa/Lagos' }],
      ['0 * * * *', { timezone: 'Africa/Lagos' }],
      ['0 9 * * *', { timezone: 'Africa/Lagos' }]
    ]);
  });

  test('running the two jobs records when they last ran', async () => {
    jobs.startJobs();
    const [reminders, cleanup] = cron.schedule.mock.calls.map((c) => c[1]);
    jobs.lastRuns.reminders = null;
    jobs.lastRuns.completeEvents = null;

    await reminders();
    await cleanup();

    expect(jobs.lastRuns.reminders).toBeInstanceOf(Date);
    expect(jobs.lastRuns.completeEvents).toBeInstanceOf(Date);
    expect(jobs.lastRuns.remindersSent).toBe(0);
  });

  test('a job that fails is logged and does not crash the site', async () => {
    jobs.startJobs();
    const [reminders, cleanup] = cron.schedule.mock.calls.map((c) => c[1]);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    await sequelize.close(); // every query now fails

    await expect(reminders()).resolves.toBeUndefined();
    await expect(cleanup()).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith('Reminder job failed:', expect.any(String));
    expect(log).toHaveBeenCalledWith('Closing finished events failed:', expect.any(String));
    log.mockRestore();
  });
});