// Geography helpers: checking coordinates, and the distance between two places.
// Everything here is plain maths on numbers, so it is easy to test. Latitude (north / south, -90 to 90)
// always comes first and longitude (east / west, -180 to 180) second, in every function and column.
const EARTH_RADIUS_KM = 6371.0088;

// A box around Ibadan. A lookup that lands outside it is a wrong match (another "Challenge" in another
// city) and is thrown away.
const IBADAN_BOUNDS = { minLat: 7.1, maxLat: 7.7, minLng: 3.6, maxLng: 4.2 };

// The middle of each local government area, used until a better address is found. Approximate: good
// enough to tell "this side of town" from "the other side".
const AREA_CENTRES = {
  akinyele: { lat: 7.53, lng: 3.91 },
  egbeda: { lat: 7.395, lng: 3.99 },
  ido: { lat: 7.48, lng: 3.82 },
  'ibadan-north': { lat: 7.43, lng: 3.917 },
  'ibadan-north-east': { lat: 7.41, lng: 3.953 },
  'ibadan-north-west': { lat: 7.387, lng: 3.886 },
  'ibadan-south-east': { lat: 7.36, lng: 3.93 },
  'ibadan-south-west': { lat: 7.35, lng: 3.87 },
  lagelu: { lat: 7.455, lng: 4.02 },
  oluyole: { lat: 7.3, lng: 3.85 },
  'ona-ara': { lat: 7.34, lng: 3.98 }
};

// a real number that can be a latitude / longitude (not null, '', NaN, or the "null island" 0,0)
function isValidCoordinate(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

function insideIbadan(lat, lng) {
  return isValidCoordinate(lat, lng)
    && lat >= IBADAN_BOUNDS.minLat && lat <= IBADAN_BOUNDS.maxLat
    && lng >= IBADAN_BOUNDS.minLng && lng <= IBADAN_BOUNDS.maxLng;
}

const toRadians = (degrees) => degrees * Math.PI / 180;

// great-circle distance in kilometres between two { lat, lng } points (haversine)
function distanceKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Where a user or an event is, as { lat, lng, approximate }, or null if nothing is known.
//  - their own saved coordinates, when valid;
//  - otherwise the middle of their local government area (approximate: true);
//  - otherwise null. A user's area key is .lga; an event's is .area.
function locationOf(record) {
  if (!record) return null;
  if (isValidCoordinate(record.latitude, record.longitude)) {
    return { lat: record.latitude, lng: record.longitude, approximate: record.geoSource === 'area' };
  }
  const key = [record.lga, record.area].find((k) => Object.prototype.hasOwnProperty.call(AREA_CENTRES, k));
  return key ? { ...AREA_CENTRES[key], approximate: true } : null;
}

module.exports = { EARTH_RADIUS_KM, IBADAN_BOUNDS, AREA_CENTRES, isValidCoordinate, insideIbadan, distanceKm, locationOf };
