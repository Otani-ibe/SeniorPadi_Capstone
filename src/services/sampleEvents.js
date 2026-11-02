// The Ibadan events list (src/scripts/data/ibadanEvents.js) and the organizations that host them.
//
// addSampleEvents only ever ADDS events (and fills in a blank number of places or area on a listed event that is already
// there). It never removes or overwrites anything, so events that staff add or edit are never touched, and running it again
// adds nothing twice.
// removeSampleEvents takes the listed events out again: only those nobody has registered for, and organizations that were
// added for them and now have no event.
//
// Used by the server at start-up (only when the database has no events at all), and by `npm run events:add` / `events:remove`.
const { Op } = require('sequelize');
const data = require('../scripts/data/ibadanEvents');

// the same church is already in the admin page under another spelling: use it, don't add a second one
const ORG_ALIASES = {
  'Cathedral Church of St. David, Kudeti': 'St. David’s Anglican Cathedral, Kudeti'
};

// "St. David’s Anglican Cathedral" and "st davids anglican cathedral" are the same name
const norm = (s) => String(s).toLowerCase().replace(/[’'`.,()]/g, '').replace(/\s+/g, ' ').trim();
const sameDay = (a, b) => new Date(a).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) === new Date(b).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

// models: the app's models. Returns { events, orgs, filled, skipped: [text] }.
async function addSampleEvents(models, { dry = false, log = () => {} } = {}) {
  const { User, Organization, Event } = models;
  const orgs = await Organization.findAll();
  const orgByName = new Map(orgs.map((o) => [norm(o.name), o]));
  const findOrg = (name) => orgByName.get(norm(ORG_ALIASES[name] || name));

  const admin = await User.findOne({ where: { role: 'admin' }, order: [['id', 'ASC']] });
  const existing = await Event.findAll({ where: { status: { [Op.ne]: 'cancelled' } } });

  const added = { events: 0, orgs: 0 };
  let filled = 0;
  const skipped = [];

  for (const e of data) {
    let org = findOrg(e.org);

    // already there? same title on the same day, or the same host on the same day
    const duplicate = existing.find((x) =>
      sameDay(x.startsAt, e.startsAt) && (norm(x.title) === norm(e.title) || (org && x.organizationId === org.id))
    );
    if (duplicate) {
      const sameEvent = norm(duplicate.title) === norm(e.title) && duplicate.startsAt.getTime() === e.startsAt.getTime();
      if (sameEvent) {
        const blanks = {};
        if (duplicate.capacity == null && e.capacity) blanks.capacity = e.capacity;
        if (!duplicate.area && e.area) blanks.area = e.area;
        if (!duplicate.imageUrl && e.imageUrl) blanks.imageUrl = e.imageUrl;
        if (Object.keys(blanks).length) {
          if (!dry) await duplicate.update(blanks);
          filled++;
          log('  ~ filled in ' + Object.keys(blanks).join(' and ') + ': ' + e.title);
          continue;
        }
      }
      // the same gathering under another name: it gets this flyer if it has none
      if (!sameEvent && !duplicate.imageUrl && e.imageUrl) {
        if (!dry) await duplicate.update({ imageUrl: e.imageUrl });
        filled++;
        log('  ~ flyer for the existing "' + duplicate.title + '"');
      }
      skipped.push(e.title + '  (same day and same ' + (norm(duplicate.title) === norm(e.title) ? 'title' : 'host') + ' as "' + duplicate.title + '")');
      continue;
    }

    if (!org) {
      if (!dry) {
        org = await Organization.create({ name: e.org, address: e.location, lga: e.area, createdByAdminId: admin ? admin.id : null });
        orgByName.set(norm(org.name), org);
      } else {
        org = { id: -(orgByName.size + 1), name: e.org }; // only for counting in a dry run
        orgByName.set(norm(e.org), org);
      }
      added.orgs++;
      log('  + organization: ' + e.org);
    }

    if (!dry) {
      const event = await Event.create({
        title: e.title,
        description: e.description,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        locationText: e.location,
        area: e.area,
        capacity: e.capacity,
        imageUrl: e.imageUrl,
        category: e.category,
        organizationId: org.id,
        // registration closes the evening before, the same as the other events
        registrationDeadline: new Date(Date.UTC(e.startsAt.getUTCFullYear(), e.startsAt.getUTCMonth(), e.startsAt.getUTCDate() - 1, 17, 0)),
        createdByAdminId: admin ? admin.id : null
      });
      existing.push(event);
    } else {
      existing.push({ title: e.title, startsAt: e.startsAt, organizationId: org.id });
    }
    added.events++;
    log('  + event: ' + e.startsAt.toISOString().slice(0, 10) + '  ' + e.title);
  }

  return { events: added.events, orgs: added.orgs, filled, skipped };
}

// models: the app's models. Returns { events, orgs }.
async function removeSampleEvents(models, { dry = false, log = () => {} } = {}) {
  const { Organization, Event, Registration } = models;
  const orgs = await Organization.findAll();
  const orgByName = new Map(orgs.map((o) => [norm(o.name), o]));
  const findOrg = (name) => orgByName.get(norm(ORG_ALIASES[name] || name));
  return removeThem(findOrg, { dry, log, Event, Registration });
}

async function removeThem(findOrg, { dry, log, Event, Registration }) {
  let events = 0;
  for (const e of data) {
    const org = findOrg(e.org);
    if (!org) continue;
    const found = await Event.findAll({ where: { title: e.title, organizationId: org.id, startsAt: e.startsAt } });
    for (const event of found) {
      const taken = await Registration.count({ where: { eventId: event.id } });
      if (taken > 0) {
        log('  keeping (' + taken + ' registered): ' + event.title);
        continue;
      }
      if (!dry) await event.destroy();
      events++;
      log('  - event: ' + event.title);
    }
  }
  // organizations from this list that are now empty
  let orgs = 0;
  for (const name of new Set(data.map((e) => e.org))) {
    if (ORG_ALIASES[name]) continue; // that one was already in the admin page before
    const org = findOrg(name);
    if (org && (await Event.count({ where: { organizationId: org.id } })) === 0) {
      if (!dry) await org.destroy();
      orgs++;
      log('  - organization: ' + org.name);
    }
  }
  return { events, orgs };
}


module.exports = { addSampleEvents, removeSampleEvents };
