// puts the logged in user, language, translations and flash messages in every view
const { User, Notification, Event, Registration } = require('../models');
const { t } = require('../services/i18n');
const fs = require('fs');
const path = require('path');
const presence = require('../services/presence');
const social = require('../services/social');
const { Op } = require('sequelize');
const dates = require('../services/dates');
const { signInExpired, bookingActive } = require('../services/sessionTimes');

// SeniorPadi's own contact details, defaults unless SUPPORT_PHONE / SUPPORT_WHATSAPP_URL are set
const DEFAULT_SUPPORT_PHONE = '+2348061761235';
const DEFAULT_SUPPORT_WHATSAPP = 'https://wa.link/lqmmfi';

// +2348061761235 -> 0806 176 1235, anything else is shown as is
function displayPhone(tel) {
  const local = /^\+234(\d{10})$/.exec(tel);
  return local ? '0' + local[1].slice(0, 3) + ' ' + local[1].slice(3, 6) + ' ' + local[1].slice(6) : tel;
}

// stylesheet url carries its last change time so a new stylesheet is never shadowed by the browser's cached copy
const CSS_FILE = path.join(__dirname, '../../public/css/main.css');
function cssVersion() {
  try { return Math.round(fs.statSync(CSS_FILE).mtimeMs); } catch (err) { return 0; }
}

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

  res.locals.cssVersion = cssVersion();
  res.locals.currentUser = user;
  // Account badge counts notifications other than messages, new messages show on Messages. Both looked up together
  const [unread, unreadFrom] = user
    ? await Promise.all([
      Notification.count({ where: { userId: user.id, readAt: null, type: { [Op.notIn]: social.MESSAGE_NOTIFICATION_TYPES } } }),
      social.unreadSenderIds(user.id)
    ])
    : [0, new Set()];
  res.locals.unreadCount = unread;
  res.locals.unreadMessages = unreadFrom.size;
  res.locals.lang = lang;
  res.locals.t = req.t;
  res.locals.formatDate = (d) => dates.formatDate(d, lang);
  res.locals.formatTime = dates.formatTime;
  // screen reader text for a button about one event: "Register: Morning walk, Tuesday 29 October".
  // starts with the button's own words so voice control ("tap Register") still finds it
  res.locals.forEvent = (label, event) => label + ': ' + (event.tTitle || event.title) + ', ' + dates.formatDate(event.startsAt, lang);
  res.locals.shortDate = dates.shortDate;
  // "2 min 14 sec" for a call that lasted this many seconds
  res.locals.callLength = (value) => {
    const s = Math.max(0, Math.round(Number(value) || 0));
    if (s >= 3600) return req.t('messages.call_len_hour', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
    if (s >= 60) return req.t('messages.call_len_min', { m: Math.floor(s / 60), s: s % 60 });
    return req.t('messages.call_len_sec', { s });
  };
  res.locals.currentPath = req.path;
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
  res.locals.appUrl = (process.env.APP_URL || '').replace(/\/$/, ''); // share picture needs a full url
  // Call and WhatsApp buttons open the phone app or WhatsApp, with SeniorPadi's own number and link
  // (SUPPORT_PHONE / SUPPORT_WHATSAPP_URL, these are the defaults)
  const supportNumber = (process.env.SUPPORT_PHONE || DEFAULT_SUPPORT_PHONE).trim();
  res.locals.supportTel = supportNumber.replace(/[^\d+]/g, ''); // +2348061761235, for tel: links
  res.locals.supportPhone = displayPhone(res.locals.supportTel); // 0806 176 1235, for people to read
  const whatsapp = (process.env.SUPPORT_WHATSAPP_URL || DEFAULT_SUPPORT_WHATSAPP).trim();
  // wa.me links can carry a message, a wa.link short link has its own so it is used as is
  const whatsappTextable = /^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//.test(whatsapp);
  res.locals.whatsappTextable = whatsappTextable;
  res.locals.whatsappLink = (message) => (whatsappTextable ? whatsapp.split('?')[0] + '?text=' + encodeURIComponent(message) : whatsapp);
  res.locals.whatsappUrl = res.locals.whatsappLink(req.t('whatsapp.hello'));
  res.locals.presenceOf = presence.statusOf; // 'online', 'offline' or null (hidden)
  res.locals.categoryIcons = Event.CATEGORY_ICONS;
  res.locals.lgas = Event.AREAS;
  // "Bodija, Ibadan North": neighbourhood and LGA, whichever they gave
  res.locals.placeOf = (person) => [person.area, person.lga ? req.t('area.' + person.lga) : null].filter(Boolean).join(', ');

  // flash messages live in the session for one page view
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => { req.session.flash = { type, message }; };

  next();
}

module.exports = locals;
