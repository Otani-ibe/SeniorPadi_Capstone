// When an admin edits an event, they choose whether to tell the seniors who are registered for it. If they say yes, each
// senior gets a text (and an email, if they gave one) and a notice in their Notifications that says exactly what is new
// ("New date and time: ..."), in their own language. Only things a senior would care about are mentioned: the name, the
// date and time, the place, and the price.
const { Op } = require('sequelize');
const { Registration, User } = require('../models');
const dates = require('./dates');
const { t } = require('./i18n');
const notifier = require('./notify');
const { addNotification } = require('./social');
const { audit } = require('./audit');

// what an event looked like before the edit (just the parts that matter)
function snapshot(event) {
  return {
    title: event.title,
    // to the minute, which is all the edit form holds: a save that did not touch the time must not look like a new time
    startsAt: Math.floor(new Date(event.startsAt).getTime() / 60000),
    endsAt: Math.floor(new Date(event.endsAt).getTime() / 60000),
    locationText: event.locationText || '',
    area: event.area || '',
    price: event.price || 0
  };
}

// which of those changed: { title, when, place, price } (true or false)
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

// the new details, one sentence each, in this language: ["New date and time: Friday, 4 December, 10:00 am – 12:30 pm."]
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

// the seniors who have a place (attending or volunteering), once each
async function registeredSeniors(eventId) {
  const regs = await Registration.findAll({ where: { eventId, status: 'registered' }, attributes: ['seniorId'] });
  const ids = Array.from(new Set(regs.map((r) => r.seniorId)));
  return ids.length ? User.findAll({ where: { id: { [Op.in]: ids }, role: 'senior' } }) : [];
}

async function countRegisteredSeniors(eventId) {
  return Registration.count({ where: { eventId, status: 'registered' }, distinct: true, col: 'seniorId' });
}

// Tells everyone registered what is new. Returns { sent, changed } (sent 0 when nothing worth mentioning changed or
// nobody is registered). `before` is snapshot(event) taken before the edit.
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

// a changed date means the reminder they were due (or already got) was for the old date: it is sent again for the new one
async function resetReminders(eventId) {
  await Registration.update({ reminderSentAt: null }, { where: { eventId, status: 'registered' } });
}

module.exports = { snapshot, whatChanged, describe, notifyRegistered, countRegisteredSeniors, resetReminders };
