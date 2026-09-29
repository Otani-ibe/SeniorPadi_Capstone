require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const sessionMiddleware = require('./config/session');

const locals = require('./middleware/locals');
const { requirePasswordChanged } = require('./middleware/auth');
const { csrfProtection, addCsrfToken } = require('./middleware/csrf');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
if (isProduction) app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '../public'), { maxAge: isProduction ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false }));

app.use(sessionMiddleware);

app.use(locals);
// token is created first so error pages can still show forms
app.use(addCsrfToken);
app.use(csrfProtection);
app.use(requirePasswordChanged);

app.use('/', require('./routes/public'));
app.use('/', require('./routes/events'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/social'));
app.use('/', require('./routes/onboarding'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: req.t('error.not_found_title'), message: req.t('error.not_found') });
});

// everything else
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { title: req.t('error.title'), message: req.t('error.form_expired') });
  }
  console.error(err);
  res.status(500).render('error', {
    title: req.t ? req.t('error.title') : 'Something went wrong',
    message: req.t ? req.t('error.server') : 'Please try again.'
  });
});

module.exports = app;
