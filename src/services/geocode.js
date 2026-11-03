// Place name -> latitude/longitude through OpenStreetMap Nominatim (1 request a second, real User-Agent).
// Never blocks a signup or an admin form, saving queues a background job.
// stored: found -> its coordinates (geoSource 'geocoded'). not found or outside Ibadan -> centre of the LGA ('area').
// no address and no area -> nothing, nearby.js handles the gap.
// env: GEOCODING=off, GEOCODER_URL, GEOCODER_EMAIL (sent so the service can contact us)
const { insideIbadan, AREA_CENTRES, IBADAN_BOUNDS } = require('./geo');
const { t } = require('./i18n');

const MIN_GAP_MS = 1100;
let lastCall = 0;

// place name -> { lat, lng } or null, never throws
async function nominatim(query) {
  if (process.env.JEST_WORKER_ID) return null; // tests never hit the network
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const base = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'ng',
    // Ibadan only. viewbox = left, top, right, bottom
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

// tests: swap in a fake lookup, no argument restores the real one
function setProvider(fn) {
  provider = fn || nominatim;
  injected = Boolean(fn);
}

function enabled() {
  if (process.env.GEOCODING === 'off') return false;
  return !process.env.JEST_WORKER_ID || injected;
}

// names to try, most exact first
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

// finds and saves coordinates for a 'user' or 'event', returns what it saved or null
async function geocodeRecord(kind, id) {
  const { User, Event } = require('../models'); // loaded here, the models load this file's hooks
  const Model = kind === 'user' ? User : Event;
  const record = await Model.findByPk(id);
  if (!record) return null;

  const found = await resolve(kind, record);
  // hooks: false so saving doesn't start another lookup
  await Model.update({ ...(found || {}), geocodedAt: new Date() }, { where: { id }, hooks: false });
  return found;
}

// one job at a time, max a request a second
let chain = Promise.resolve();

function queue(kind, id) {
  if (!enabled()) return;
  chain = chain
    .then(() => geocodeRecord(kind, id))
    .catch((err) => { if (!process.env.JEST_WORKER_ID) console.error('Could not find the coordinates of ' + kind + ' ' + id + ':', err.message); });
}

// resolves when the queue is empty
function idle() {
  return chain;
}

module.exports = { setProvider, enabled, addressQueries, resolve, geocodeRecord, queue, idle };
