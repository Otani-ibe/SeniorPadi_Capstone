// Picks the database and whether it needs SSL. Shared by Sequelize, sequelize-cli and the session store.
//   DB_TARGET=local  -> LOCAL_DATABASE_URL (Postgres on your computer)
//   DB_TARGET=neon   -> NEON_DATABASE_URL  (Neon in the cloud)
//   no DB_TARGET     -> DATABASE_URL       (what Render sets in production)
//   running tests    -> TEST_DATABASE_URL  (always, it gets wiped)
require('dotenv').config({ quiet: true });

function pickUrl() {
  if (process.env.NODE_ENV === 'test') {
    return { target: 'test', url: process.env.TEST_DATABASE_URL, envName: 'TEST_DATABASE_URL' };
  }

  const target = (process.env.DB_TARGET || '').toLowerCase();
  if (target === 'local') {
    return { target, url: process.env.LOCAL_DATABASE_URL, envName: 'LOCAL_DATABASE_URL' };
  }
  if (target === 'neon') {
    return { target, url: process.env.NEON_DATABASE_URL, envName: 'NEON_DATABASE_URL' };
  }
  return { target: 'default', url: process.env.DATABASE_URL, envName: 'DATABASE_URL' };
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function getDatabaseSettings() {
  const { target, url, envName } = pickUrl();

  if (!url) {
    throw new Error(
      'No database URL found. Set ' + envName + ' in your .env file' +
      (target === 'default' ? ' (or set DB_TARGET=local / DB_TARGET=neon)' : '') + '.'
    );
  }

  const parsed = new URL(url);
  const host = parsed.hostname;

  // Neon always needs SSL. Other hosts only if DB_SSL=true. Never for localhost.
  const isNeon = host.endsWith('.neon.tech');
  const wantsSsl = !isLocalHost(host) && (isNeon || process.env.DB_SSL === 'true' || parsed.searchParams.has('sslmode'));

  // SSL is set below, strip these from the URL (sslmode makes pg print a security warning)
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('channel_binding');

  let ssl = false;
  if (wantsSsl) {
    // Neon has proper certificates so check them. For hosts with self-signed ones set DB_SSL_STRICT=false
    ssl = { require: true, rejectUnauthorized: isNeon || process.env.DB_SSL_STRICT !== 'false' };
  }

  return { target, host, url: parsed.toString(), ssl };
}

module.exports = { getDatabaseSettings };
