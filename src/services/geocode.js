// Turns a place written in words ("Bodija, Ibadan North") into latitude / longitude.
//
// The lookup uses OpenStreetMap's free Nominatim service (no key needed; its rules are one request a
// second and a real User-Agent, both handled below). Nothing here ever blocks a signup or an admin form:
// saving a senior or an event just puts a job in a small queue that runs in the background.
//
// What is stored (see the migration):
//  - the address was found           -> its coordinates, geoSource 'geocoded'
//  - not found (or found in another city, outside Ibadan) -> the middle of their local government area,
//                                       geoSource 'area'
//  - no address and no area at all   -> nothing stored (the ranking then handles the gap, see nearby.js)
//
// Settings (optional): GEOCODING=off turns lookups off; GEOCODER_URL changes the service;
// GEOCODER_EMAIL is sent so the service can contact us if we misbehave.
const { insideIbadan, AREA_CENTRES, IBADAN_BOUNDS } = require('./geo');
const { t } = require('./i18n');

const MIN_GAP_MS = 1100;
let lastCall = 0;

// one place name -> { lat, lng } or null. Never throws: a network problem is just "not found".
async function nominatim(query) {
  if (process.env.JEST_WORKER_ID) return null; // tests never call the internet
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const base = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'ng',
    // look inside Ibadan only: viewbox is left, top, right, bottom as longitude, latitude
    viewbox: [IBADAN_BOUNDS.minLng, IBADAN_BOUNDS.maxLat, IBADAN_BOUNDS.maxLng, IBADAN_BOUNDS.minLat].join(','),
    bounded: '1'
  });
  try {
    const res = await fetch(base + '?' + params, {
      headers: { 'User-Agent': 'SeniorPadi/1.0 (' + (process.env.GEOCODER_EMAIL || process.env.BREVO_SENDER_EMAIL || 'hello@seniorpadi.org') + ')' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const first = Array.isArray(rows) ? rows[0] : null;
    return first ? { lat: Number(first.lat), lng: Number(first.lon) } : null;
  } catch (err) {
    return null;
  }
}

let provider = nominatim;
let injected = false;

// for tests: swap the lookup for a fake one (pass nothing to put the real one back)
function setProvider(fn) {
  provider = fn || nominatim;
  injected = Boolean(fn);
}

function enabled() {
  if (process.env.GEOCODING === 'off') return false;
  return !process.env.JEST_WORKER_ID || injected;
}

// the place names to try for a record, most exact first
function addressQueries(kind, record) {
  const areaName = (key) => (AREA_CENTRES[key] ? t('area.' + key, 'en') : '');
  if (kind === 'user') {
    const area = (record.area || '').trim();
    if (!area) return [];
    const lga = areaName(record.lga);
    return [lga ? area + ', ' + lga + ', Ibadan, Nigeria' : null, area + ', Ibadan, Nigeria'].filter(Boolean);
  }
  const venue = (record.locationText || '').trim();
  if (!venue) return [];
  const lga = areaName(record.area);
  return [lga ? venue + ', ' + lga + ', Ibadan, Nigeria' : null, venue + ', Ibadan, Nigeria'].filter(Boolean);
}

// -> { latitude, longitude, geoSource } or null
async function resolve(kind, record) {
  for (const query of addressQueries(kind, record)) {
    const found = await provider(query);
    if (found && insideIbadan(found.lat, found.lng)) {
      return { latitude: found.lat, longitude: found.lng, geoSource: 'geocoded' };
    }
  }
  const key = kind === 'user' ? record.lga : record.area;
  const centre = AREA_CENTRES[key];
  return centre ? { latitude: centre.lat, longitude: centre.lng, geoSource: 'area' } : null;
}

// finds and saves the coordinates of one user ('user') or event ('event'). Returns what it saved, or null.
async function geocodeRecord(kind, id) {
  const { User, Event } = require('../models'); // loaded here because the models load this file's hooks
  const Model = kind === 'user' ? User : Event;
  const record = await Model.findByPk(id);
  if (!record) return null;

  const found = await resolve(kind, record);
  // hooks: false, so saving the result does not start another lookup
  await Model.update({ ...(found || {}), geocodedAt: new Date() }, { where: { id }, hooks: false });
  return found;
}

// jobs run one after another, so the service is never asked for more than a request a second
let chain = Promise.resolve();

function queue(kind, id) {
  if (!enabled()) return;
  chain = chain
    .then(() => geocodeRecord(kind, id))
    .catch((err) => { if (!process.env.JEST_WORKER_ID) console.error('Could not find the coordinates of ' + kind + ' ' + id + ':', err.message); });
}

// resolves when every queued lookup is finished
function idle() {
  return chain;
}

module.exports = { setProvider, enabled, addressQueries, resolve, geocodeRecord, queue, idle };
