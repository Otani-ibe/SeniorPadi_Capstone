// Admin edit -> optionally tell registered seniors (text, email if given, and a notice, in their language) exactly what is new.
// only the name, date and time, place and price are mentioned
const { Op } = require('sequelize');
const { Registration, User } = require('../models');
const dates = require('./dates');
const { t } = require('./i18n');
const notifier = require('./notify');
const { addNotification } = require('./social');
const { audit } = require('./audit');

// the event before the edit, relevant fields only
function snapshot(event) {
  return {
    title: event.title,
    // to the minute, the form holds no seconds, an untouched time must not look new
    startsAt: Math.floor(new Date(event.startsAt).getTime() / 60000),
    endsAt: Math.floor(new Date(event.endsAt).getTime() / 60000),
    locationText: event.locationText || '',
    area: event.area || '',
    price: event.price || 0
  };
}

// which changed: { title, when, place, price }
function whatChanged(before, event) {
  const now = snapshot(event);
  return {
    title: now.title !== before.title,
    when: now.startsAt !== before.startsAt || now.endsAt !== before.endsAt,
    place: now.locationText !== before.locationText || now.area !== before.area,
    price: now.price !== before.price
  };
}

const anyChange = (changed) => Object.values(changed).some(Boolean);

// new details, one sentence each, in this language
function describe(event, changed, lang) {
  const lines = [];
  if (changed.title) lines.push(t('event.change.title', lang, { title: event.title }));
  if (changed.when) {
    const when = dates.formatDate(event.startsAt, lang) + ', ' + dates.formatTime(event.startsAt) + ' – ' + dates.formatTime(event.endsAt);
    lines.push(t('event.change.when', lang, { when }));
  }
  if (changed.place) {
    const place = [event.locationText, event.area ? t('area.' + event.area, lang) : ''].filter(Boolean).join(', ');
    lines.push(t('event.change.place', lang, { place }));
  }
  if (changed.price) {
    lines.push(t('event.change.price', lang, { price: event.price > 0 ? '₦' + Number(event.price).toLocaleString('en-NG') : t('events.free', lang) }));
  }
  return lines;
}

// seniors with a place (attending or volunteering), once each
async function registeredSeniors(eventId) {
  const regs = await Registration.findAll({ where: { eventId, status: 'registered' }, attributes: ['seniorId'] });
  const ids = Array.from(new Set(regs.map((r) => r.seniorId)));
  return ids.length ? User.findAll({ where: { id: { [Op.in]: ids }, role: 'senior' } }) : [];
}

async function countRegisteredSeniors(eventId) {
  return Registration.count({ where: { eventId, status: 'registered' }, distinct: true, col: 'seniorId' });
}

// tells everyone registered what is new -> { sent, changed } (sent 0 when nothing relevant changed or nobody is registered)
// before = snapshot(event) taken before the edit
async function notifyRegistered(adminId, event, before) {
  const changed = whatChanged(before, event);
  if (!anyChange(changed)) return { sent: 0, changed: false };

  const seniors = await registeredSeniors(event.id);
  for (const senior of seniors) {
    const lang = senior.preferredLanguage || 'en';
    const changes = describe(event, changed, lang).join(' ');
    try {
      await addNotification(senior.id, 'event.updated', { event: event.title, changes }, '/events/' + event.id);
    } catch (err) {
      console.error('Could not save the event update notice:', err.message);
    }
    notifier.notify(senior, 'event.updated', { name: senior.firstName(), event: event.title, changes });
  }
  await audit(adminId, 'event.update_notified', 'Event', event.id, { told: seniors.length, changed: Object.keys(changed).filter((k) => changed[k]) });
  return { sent: seniors.length, changed: true };
}

// date changed: the reminder due or already sent was for the old date, send again
async function resetReminders(eventId) {
  await Registration.update({ reminderSentAt: null }, { where: { eventId, status: 'registered' } });
}

module.exports = { snapshot, whatChanged, describe, notifyRegistered, countRegisteredSeniors, resetReminders };
