// Session setup lives here because both Express and Socket.IO use it
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const { getDatabaseSettings } = require('./database');

// same database and SSL settings as Sequelize
const db = getDatabaseSettings();
const sessionPool = new Pool({ connectionString: db.url, ssl: db.ssl || false, max: 3 });

const isProduction = process.env.NODE_ENV === 'production';

const sessionMiddleware = session({
  store: new PgSession({
    pool: sessionPool,
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days, seniors shouldn't have to log in often
  }
});

module.exports = sessionMiddleware;
