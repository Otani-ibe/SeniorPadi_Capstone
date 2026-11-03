// Voice calls between seniors. Audio is WebRTC, phone to phone. The server tracks who calls whom and relays set-up (sockets/calls.js).
// in memory, a restart ends calls in progress
const RING_SECONDS = 30; // seconds before a call counts as missed

const calls = new Map(); // call id -> { id, callerId, calleeId, state, callerSocket, calleeSocket, timer }
const byUser = new Map(); // user id -> call id (a person can only be in one call)
let nextId = 1;

function isBusy(userId) {
  return byUser.has(userId);
}

function create(callerId, calleeId, callerSocket) {
  const call = { id: String(nextId++), callerId, calleeId, state: 'ringing', callerSocket, calleeSocket: null, timer: null };
  calls.set(call.id, call);
  byUser.set(callerId, call.id);
  byUser.set(calleeId, call.id);
  return call;
}

function get(callId) {
  return calls.get(String(callId)) || null;
}

function forUser(userId) {
  return get(byUser.get(userId));
}

function end(call) {
  clearTimeout(call.timer);
  calls.delete(call.id);
  if (byUser.get(call.callerId) === call.id) byUser.delete(call.callerId);
  if (byUser.get(call.calleeId) === call.id) byUser.delete(call.calleeId);
}

// relay (TURN) servers for when a direct line is blocked, common on mobile. Cloudflare credentials are short-lived.
// no settings, or Cloudflare unreachable: a free public server (testing only)
const FALLBACK = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
const TTL_SECONDS = 3600;
let cached = null; // { servers, until }

async function getIceServers() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return FALLBACK;
  if (cached && cached.until > Date.now()) return cached.servers;

  try {
    const res = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(keyId) + '/credentials/generate-ice-servers', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error('Cloudflare answered ' + res.status);
    const data = await res.json();
    const servers = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : null;
    if (!servers || !servers.length) throw new Error('no servers in the answer');
    // reuse for half their life
    cached = { servers, until: Date.now() + (TTL_SECONDS / 2) * 1000 };
    return servers;
  } catch (err) {
    console.error('Could not get call relay servers:', err.message);
    return FALLBACK;
  }
}

module.exports = { RING_SECONDS, isBusy, create, get, forUser, end, getIceServers };
