// Makes the logged in user, language, translations and flash messages
// available in every view.
const { User, Notification, Event, Registration } = require('../models');
const { t } = require('../services/i18n');
const dates = require('../services/dates');
const { signInExpired, bookingActive } = require('../services/sessionTimes');

async function locals(req, res, next) {
  let user = null;
  // 30 days after signing in, they sign in again (older sessions start counting now)
  if (req.session.userId && !req.session.signedInAt) req.session.signedInAt = Date.now();
  if (req.session.userId && signInExpired(req.session.signedInAt)) {
    delete req.session.userId;
    delete req.session.signedInAt;
  }
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
  res.locals.shortDate = dates.shortDate;
  res.locals.currentPath = req.path;
  res.locals.supportPhone = process.env.SUPPORT_PHONE || '';
  // booking events for a parent (see routes/bookForParent.js): who for, while it lasts
  const booking = req.session.bookingFor;
  res.locals.bookingFor = !user && bookingActive(booking) ? { name: booking.name } : null;
  // a parent was just registered by their child: show the pop-up once
  res.locals.bookedPopup = null;
  if (req.session.bookedPopup) {
    const reg = await Registration.findByPk(req.session.bookedPopup, { include: [Event, { model: User, as: 'senior' }] });
    delete req.session.bookedPopup;
    if (reg && reg.Event && reg.senior) res.locals.bookedPopup = { name: reg.senior.firstName(), event: reg.Event, ticket: reg.ticketNumber };
  }
  res.locals.appUrl = (process.env.APP_URL || '').replace(/\/$/, ''); // for the share picture, which needs a full web address
  // the Call and WhatsApp buttons open the phone app or WhatsApp, not another page.
  // WHATSAPP_NUMBER is used if set, otherwise the support number. Nigerian 0... numbers become 234...
  const waNumber = (process.env.WHATSAPP_NUMBER || process.env.SUPPORT_PHONE || '').replace(/[^\d+]/g, '');
  const waDigits = waNumber.startsWith('+') ? waNumber.slice(1) : waNumber.startsWith('0') ? '234' + waNumber.slice(1) : waNumber;
  res.locals.supportTel = (process.env.SUPPORT_PHONE || '').replace(/[^\d+]/g, '');
  res.locals.whatsappUrl = waDigits ? 'https://wa.me/' + waDigits + '?text=' + encodeURIComponent(req.t('whatsapp.hello')) : '';
  res.locals.categoryIcons = Event.CATEGORY_ICONS;
  res.locals.lgas = Event.AREAS;
  // "Bodija, Ibadan North": their neighbourhood and local government area, whichever they gave
  res.locals.placeOf = (person) => [person.area, person.lga ? req.t('area.' + person.lga) : null].filter(Boolean).join(', ');

  // flash messages live in the session for one page view
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => { req.session.flash = { type, message }; };

  next();
}

module.exports = locals;
