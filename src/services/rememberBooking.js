// Booking for a parent: the son or daughter's name and number, and the parent's number, remembered on THEIR phone
// (a cookie, nothing on the server) so next time the form is already filled in. The parent's code is still needed every time.
const COOKIE = 'sp_book_for';
const DAYS = 90;

// +2348031112222 -> 08031112222
const localPhone = (tel) => (tel && tel.startsWith('+234') ? '0' + tel.slice(4) : tel || '');

// { childName, childPhone, parentPhone } or null
function remembered(req) {
  const raw = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1)));
    if (!data || typeof data.childName !== 'string') return null;
    return { childName: data.childName.slice(0, 80), childPhone: String(data.childPhone || ''), parentPhone: String(data.parentPhone || '') };
  } catch (err) {
    return null;
  }
}

function remember(res, { childName, childPhone, parentPhone }) {
  res.cookie(COOKIE, JSON.stringify({ childName, childPhone: localPhone(childPhone), parentPhone: localPhone(parentPhone) }), {
    maxAge: DAYS * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
}

function forget(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

module.exports = { remembered, remember, forget, localPhone, COOKIE };
