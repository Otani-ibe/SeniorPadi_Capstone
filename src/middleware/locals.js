// Makes the logged in user, language, translations and flash messages
// available in every view.
const { User, Notification } = require('../models');
const { t } = require('../services/i18n');
const dates = require('../services/dates');

async function locals(req, res, next) {
  let user = null;
  if (req.session.userId) {
    user = await User.findByPk(req.session.userId); // returns null if soft-deleted
    if (!user) delete req.session.userId;
  }

  const lang = user ? user.preferredLanguage : (req.session.lang || 'en');

  req.user = user;
  req.lang = lang;
  req.t = (key, vars) => t(key, lang, vars);

  res.locals.currentUser = user;
  res.locals.unreadCount = user ? await Notification.count({ where: { userId: user.id, readAt: null } }) : 0;
  res.locals.lang = lang;
  res.locals.t = req.t;
  res.locals.formatDate = (d) => dates.formatDate(d, lang);
  res.locals.formatTime = dates.formatTime;
  res.locals.currentPath = req.path;
  res.locals.supportPhone = process.env.SUPPORT_PHONE || '';

  // flash messages live in the session for one page view
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => { req.session.flash = { type, message }; };

  next();
}

module.exports = locals;
