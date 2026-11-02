// Who is online right now. A person counts as online while at least one of their
// browser tabs or phones has a live connection (see sockets/index.js).
// Kept in memory: after a restart everyone simply reconnects.
const counts = new Map();

// returns true when this was their first connection (they just came online)
function connected(userId) {
  const n = (counts.get(userId) || 0) + 1;
  counts.set(userId, n);
  return n === 1;
}

// returns true when that was their last connection (they just went offline)
function disconnected(userId) {
  const n = (counts.get(userId) || 1) - 1;
  if (n <= 0) {
    counts.delete(userId);
    return true;
  }
  counts.set(userId, n);
  return false;
}

// 'online', 'offline', or null when they chose to hide it (show nothing at all)
function statusOf(user) {
  if (!user || user.showOnlineStatus === false) return null;
  return counts.has(user.id) ? 'online' : 'offline';
}

module.exports = { connected, disconnected, statusOf, presenceRoom: (id) => 'presence:' + id };
