// File storage: saved on this computer without Cloudinary keys, sent to Cloudinary with them (the Cloudinary calls are replaced).
const fs = require('fs');
const cloud = require('../src/services/cloudinary');

const NAMES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const saved = {};
const made = []; // local files this test file created, removed at the end

beforeAll(() => NAMES.forEach((n) => { saved[n] = process.env[n]; }));
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  NAMES.forEach((n) => { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; });
  made.forEach((publicId) => { const p = cloud.localPath(publicId); if (p) fs.rmSync(p, { force: true }); });
});

function withoutKeys() { NAMES.forEach((n) => delete process.env[n]); }
function withKeys() {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
  process.env.CLOUDINARY_API_KEY = '123456';
  process.env.CLOUDINARY_API_SECRET = 'shhh-secret';
  cloud.cloudinary.config({ cloud_name: 'demo-cloud', api_key: '123456', api_secret: 'shhh-secret', secure: true });
}

describe('without Cloudinary keys', () => {
  beforeEach(withoutKeys);

  test('isConfigured is false', () => {
    expect(cloud.isConfigured()).toBe(false);
  });

  test('a public picture is saved on this computer and gets a web address', async () => {
    const result = await cloud.uploadBuffer(Buffer.from('fake-png'), 'profile', 'image/png');
    made.push(result.publicId);

    expect(result.format).toBe('png');
    expect(result.url).toMatch(/^\/uploads\/profile\/[0-9a-f-]+\.png$/);
    expect(result.publicId).toMatch(/^local:uploads\/profile\//);
    expect(fs.readFileSync(cloud.localPath(result.publicId), 'utf8')).toBe('fake-png');
  });

  test('a private ID file gets no web address and goes to the private folder', async () => {
    const result = await cloud.uploadBuffer(Buffer.from('fake-pdf'), 'id', 'application/pdf');
    made.push(result.publicId);

    expect(result.url).toBeNull();
    expect(result.format).toBe('pdf');
    expect(result.publicId).toMatch(/^local:ids\//);
    expect(cloud.localPath(result.publicId)).toContain('storage');
    expect(fs.existsSync(cloud.localPath(result.publicId))).toBe(true);
  });

  test('an unknown file type is saved with a .bin ending', async () => {
    const result = await cloud.uploadBuffer(Buffer.from('x'), 'event', 'application/x-weird');
    made.push(result.publicId);
    expect(result.format).toBe('bin');
  });

  test('deleteFile removes a local file, and ignores empty or unknown ids', async () => {
    const result = await cloud.uploadBuffer(Buffer.from('bye'), 'profile', 'image/jpeg');
    const file = cloud.localPath(result.publicId);
    expect(fs.existsSync(file)).toBe(true);

    await cloud.deleteFile(result.publicId);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the removal runs in the background
    expect(fs.existsSync(file)).toBe(false);

    await expect(cloud.deleteFile(null)).resolves.toBeUndefined();
    await expect(cloud.deleteFile('seniorpadi/public/profiles/abc')).resolves.toBeUndefined(); // not local, no keys
  });

  test('localPath is null for a Cloudinary id or nothing', () => {
    expect(cloud.localPath(null)).toBeNull();
    expect(cloud.localPath('seniorpadi/public/events/abc')).toBeNull();
  });

  test('a local video id turns into a plain address', () => {
    expect(cloud.videoUrl('local:uploads/video/abc.mp4')).toBe('/uploads/video/abc.mp4');
  });
});

describe('with Cloudinary keys', () => {
  beforeEach(withKeys);

  test('isConfigured is true', () => {
    expect(cloud.isConfigured()).toBe(true);
  });

  test('a picture is streamed to Cloudinary with the profile settings, and the answer is passed on', async () => {
    let seen;
    jest.spyOn(cloud.cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => {
      seen = options;
      return { end: () => callback(null, { secure_url: 'https://res.cloudinary.com/demo/p.jpg', public_id: 'seniorpadi/public/profiles/p', format: 'jpg' }) };
    });

    const result = await cloud.uploadBuffer(Buffer.from('img'), 'profile', 'image/jpeg');

    expect(result).toEqual({ url: 'https://res.cloudinary.com/demo/p.jpg', publicId: 'seniorpadi/public/profiles/p', format: 'jpg' });
    expect(seen.folder).toBe('seniorpadi/public/profiles');
    expect(seen.type).toBe('upload');
    expect(seen.resource_type).toBe('auto');
  });

  test('ID documents are uploaded as private', async () => {
    let seen;
    jest.spyOn(cloud.cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => {
      seen = options;
      return { end: () => callback(null, { secure_url: 'x', public_id: 'y', format: 'png' }) };
    });
    await cloud.uploadBuffer(Buffer.from('id'), 'id', 'image/png');
    expect(seen.type).toBe('private');
    expect(seen.folder).toBe('seniorpadi/private/ids');
  });

  test('an upload error from Cloudinary is passed on to the caller', async () => {
    jest.spyOn(cloud.cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => ({
      end: () => callback(new Error('quota reached'))
    }));
    await expect(cloud.uploadBuffer(Buffer.from('img'), 'event', 'image/png')).rejects.toThrow('quota reached');
  });

  test('deleteFile asks Cloudinary to destroy the file with the right type', async () => {
    const destroy = jest.spyOn(cloud.cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    await cloud.deleteFile('seniorpadi/private/ids/abc', 'private');
    expect(destroy).toHaveBeenCalledWith('seniorpadi/private/ids/abc', { type: 'private', resource_type: 'image' });
  });

  test('a failed delete is logged but never thrown', async () => {
    jest.spyOn(cloud.cloudinary.uploader, 'destroy').mockRejectedValue(new Error('network'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(cloud.deleteFile('seniorpadi/public/profiles/abc')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  test('the signed link for an ID is private, signed, and expires in about five minutes', () => {
    const before = Math.floor(Date.now() / 1000);
    const url = new URL(cloud.signedIdUrl('seniorpadi/private/ids/abc', 'jpg'));
    const expires = Number(url.searchParams.get('expires_at'));

    expect(url.hostname).toContain('cloudinary.com');
    expect(url.searchParams.get('signature')).toBeTruthy();
    expect(url.searchParams.get('type')).toBe('private');
    expect(expires - before).toBeGreaterThanOrEqual(299);
    expect(expires - before).toBeLessThanOrEqual(305);
  });

  test('the video address is a small 480p mp4 on Cloudinary', () => {
    const url = cloud.videoUrl('seniorpadi/public/onboarding/welcome');
    expect(url).toContain('https://res.cloudinary.com/demo-cloud/video/upload/');
    expect(url).toContain('w_854');
    expect(url).toContain('h_480');
    expect(url).toMatch(/\.mp4(\?|$)/);
  });
});
