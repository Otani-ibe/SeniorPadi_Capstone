// Call book-keeping (who is in a call) and the relay servers. Needs no database.
const NAMES = ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN'];
const saved = {};
let realFetch;
let calls;

beforeAll(() => {
  NAMES.forEach((n) => { saved[n] = process.env[n]; });
  realFetch = global.fetch;
});

beforeEach(() => {
  jest.resetModules(); // each test starts with an empty call list and an empty relay cache
  calls = require('../src/services/calls');
  NAMES.forEach((n) => delete process.env[n]);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  global.fetch = realFetch;
  NAMES.forEach((n) => { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; });
});

describe('who is in a call', () => {
  test('a new call is ringing and both people are busy', () => {
    const call = calls.create(1, 2, 'socket-a');

    expect(call.state).toBe('ringing');
    expect(call.callerSocket).toBe('socket-a');
    expect(call.calleeSocket).toBeNull();
    expect(calls.isBusy(1)).toBe(true);
    expect(calls.isBusy(2)).toBe(true);
    expect(calls.isBusy(3)).toBe(false);
  });

  test('a call can be found by its id (number or text) and by either person', () => {
    const call = calls.create(1, 2, 's');

    expect(calls.get(call.id)).toBe(call);
    expect(calls.get(Number(call.id))).toBe(call);
    expect(calls.forUser(1)).toBe(call);
    expect(calls.forUser(2)).toBe(call);
    expect(calls.get('999')).toBeNull();
    expect(calls.forUser(77)).toBeNull();
  });

  test('every call gets its own id', () => {
    const a = calls.create(1, 2, 's');
    const b = calls.create(3, 4, 's');
    expect(a.id).not.toBe(b.id);
  });

  test('ending a call frees both people and stops the ring timer', () => {
    const call = calls.create(1, 2, 's');
    const fired = jest.fn();
    call.timer = setTimeout(fired, 20);

    calls.end(call);

    expect(calls.get(call.id)).toBeNull();
    expect(calls.isBusy(1)).toBe(false);
    expect(calls.isBusy(2)).toBe(false);
    return new Promise((resolve) => setTimeout(resolve, 60)).then(() => expect(fired).not.toHaveBeenCalled());
  });

  test('ending an old call does not free someone who has already started a newer one', () => {
    const old = calls.create(1, 2, 's');
    calls.end(old);
    const fresh = calls.create(1, 3, 's');

    calls.end(old); // ended twice by mistake

    expect(calls.forUser(1)).toBe(fresh);
    expect(calls.isBusy(3)).toBe(true);
  });

  test('a call counts as missed after 30 seconds of ringing', () => {
    expect(calls.RING_SECONDS).toBe(30);
  });
});

describe('relay servers', () => {
  const OK = (iceServers) => ({ ok: true, status: 200, json: async () => ({ iceServers }) });

  function configured() {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key-1';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token-1';
  }

  test('without Cloudflare settings the free public servers are used and nothing is requested', async () => {
    global.fetch = jest.fn();
    const servers = await calls.getIceServers();

    expect(servers.length).toBeGreaterThan(0);
    expect(servers.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('with settings, Cloudflare is asked for short-lived servers using the token', async () => {
    configured();
    const relay = [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }];
    global.fetch = jest.fn().mockResolvedValue(OK(relay));

    const servers = await calls.getIceServers();

    expect(servers).toEqual(relay);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/turn/keys/key-1/credentials/generate-ice-servers');
    expect(options.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(options.body)).toEqual({ ttl: 3600 });
  });

  test('an answer that is a single object instead of a list is wrapped in a list', async () => {
    configured();
    const one = { urls: ['turn:x'], username: 'u', credential: 'c' };
    global.fetch = jest.fn().mockResolvedValue(OK(one));
    expect(await calls.getIceServers()).toEqual([one]);
  });

  test('the answer is reused, so Cloudflare is asked only once', async () => {
    configured();
    global.fetch = jest.fn().mockResolvedValue(OK([{ urls: ['turn:x'] }]));

    await calls.getIceServers();
    await calls.getIceServers();
    await calls.getIceServers();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('when Cloudflare says no, the public servers are used and the problem is logged', async () => {
    configured();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    const servers = await calls.getIceServers();

    expect(servers.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  test('an empty answer, or no connection at all, also falls back', async () => {
    configured();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn().mockResolvedValue(OK([]));
    expect((await calls.getIceServers())[0].urls).toMatch(/^stun:/);

    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect((await calls.getIceServers())[0].urls).toMatch(/^stun:/);
  });
});
