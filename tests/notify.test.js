// SMS and email through Brevo. fetch is replaced, so nothing is really sent.
const { sendSms, sendEmail, notify } = require('../src/services/notify');
const { AuditLog } = require('../src/models');
const { resetDb, makeUser, sequelize } = require('./helpers');

const NAMES = ['BREVO_API_KEY', 'NOTIFY_DRY_RUN', 'BREVO_SENDER_NAME', 'BREVO_SENDER_EMAIL', 'BREVO_SMS_SENDER'];
const saved = {};
const VARS = { name: 'Ade', event: 'Morning walk', date: '5 Dec', time: '9:00 am', place: 'Bodija', ticket: 'ABC123' };

let realFetch;
let fetchMock;

beforeAll(() => {
  NAMES.forEach((n) => { saved[n] = process.env[n]; });
  realFetch = global.fetch;
});

beforeEach(async () => {
  await resetDb();
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_SENDER_NAME = 'SeniorPadi';
  process.env.BREVO_SENDER_EMAIL = 'hello@seniorpadi.test';
  delete process.env.NOTIFY_DRY_RUN;
  delete process.env.BREVO_SMS_SENDER;
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  global.fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(async () => {
  global.fetch = realFetch;
  NAMES.forEach((n) => { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; });
  await sequelize.close();
});

test('an SMS goes to Brevo with the key, the number without a plus, and the text in the senior language', async () => {
  const user = await makeUser({ preferredLanguage: 'en' });
  await sendSms(user, 'event.reminder', VARS);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.brevo.com/v3/transactionalSMS/sms');
  expect(options.headers['api-key']).toBe('test-key');
  const body = JSON.parse(options.body);
  expect(body.recipient).toBe(user.phone.replace('+', ''));
  expect(body.recipient).not.toContain('+');
  expect(body.sender).toBe('SeniorPadi');
  expect(body.type).toBe('transactional');
  expect(body.content).toContain('Morning walk');
  expect(body.content).toContain('ABC123');
});

test('a sender name from the settings is used for SMS', async () => {
  process.env.BREVO_SMS_SENDER = 'PadiNG';
  await sendSms(await makeUser(), 'event.reminder', VARS);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender).toBe('PadiNG');
});

test('an email goes to Brevo with the sender, the receiver and a rendered page', async () => {
  const user = await makeUser({ email: 'ade@example.com' });
  await sendEmail(user, 'event.reminder', VARS);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.brevo.com/v3/smtp/email');
  const body = JSON.parse(options.body);
  expect(body.sender).toEqual({ name: 'SeniorPadi', email: 'hello@seniorpadi.test' });
  expect(body.to).toEqual([{ email: 'ade@example.com', name: user.fullName }]);
  expect(body.subject).toBe('Reminder: Morning walk is coming up');
  expect(body.htmlContent).toContain('Morning walk');
});

test('no email address means no email, and the SMS is not affected', async () => {
  const user = await makeUser({ email: null });
  await sendEmail(user, 'event.reminder', VARS);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a Yorùbá senior gets the Yorùbá text', async () => {
  const user = await makeUser({ preferredLanguage: 'yo' });
  await sendSms(user, 'event.reminder', VARS);
  const yoText = JSON.parse(fetchMock.mock.calls[0][1].body).content;

  fetchMock.mockClear();
  await sendSms(await makeUser({ preferredLanguage: 'en' }), 'event.reminder', VARS);
  expect(yoText).not.toBe(JSON.parse(fetchMock.mock.calls[0][1].body).content);
});

test('dry run sends nothing, either by setting or because there is no key', async () => {
  const user = await makeUser({ email: 'ade@example.com' });

  process.env.NOTIFY_DRY_RUN = 'true';
  await sendSms(user, 'event.reminder', VARS);
  await sendEmail(user, 'event.reminder', VARS);

  delete process.env.NOTIFY_DRY_RUN;
  delete process.env.BREVO_API_KEY;
  await sendSms(user, 'event.reminder', VARS);
  await sendEmail(user, 'event.reminder', VARS);

  expect(fetchMock).not.toHaveBeenCalled();
});

test('a refused SMS (4xx) is written to the audit log and does not throw', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad sender' });
  const user = await makeUser();

  await expect(sendSms(user, 'event.reminder', VARS)).resolves.toBeUndefined();

  expect(fetchMock).toHaveBeenCalledTimes(1); // a 4xx is not retried
  const log = await AuditLog.findOne({ where: { action: 'notify.sms_failed', entityId: user.id } });
  expect(log).not.toBeNull();
  expect(log.metadata.error).toContain('400');
});

test('a refused email is written to the audit log too', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
  const user = await makeUser({ email: 'ade@example.com' });

  await sendEmail(user, 'event.reminder', VARS);

  expect(await AuditLog.count({ where: { action: 'notify.email_failed', entityId: user.id } })).toBe(1);
});

test('a Brevo outage (5xx) is tried once more after 30 seconds, and a second success counts', async () => {
  jest.useFakeTimers();
  fetchMock
    .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down' })
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
  const user = await makeUser();

  const sending = sendSms(user, 'event.reminder', VARS);
  await jest.advanceTimersByTimeAsync(29 * 1000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(2 * 1000);
  await sending;

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await AuditLog.count({ where: { action: 'notify.sms_failed' } })).toBe(0);
});

test('if the retry also fails the failure is logged and only two tries are made', async () => {
  jest.useFakeTimers();
  fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'still down' });
  const user = await makeUser();

  const sending = sendSms(user, 'event.reminder', VARS);
  await jest.advanceTimersByTimeAsync(31 * 1000);
  await sending;

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await AuditLog.count({ where: { action: 'notify.sms_failed', entityId: user.id } })).toBe(1);
});

test('notify() sends on the channels it is given and does not wait for them', async () => {
  const user = await makeUser({ email: 'ade@example.com' });

  notify(user, 'event.reminder', VARS, ['sms']);
  await new Promise((resolve) => setImmediate(resolve));
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://api.brevo.com/v3/transactionalSMS/sms']);

  fetchMock.mockClear();
  notify(user, 'event.reminder', VARS); // both by default
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
    'https://api.brevo.com/v3/smtp/email',
    'https://api.brevo.com/v3/transactionalSMS/sms'
  ]);
});
