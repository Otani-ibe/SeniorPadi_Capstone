// Optional check-in code. Staff can scan it to mark attendance faster.
// Seniors never need it: their name is on the printed list.
const QRCode = require('qrcode');

function scanUrl(qrToken) {
  return (process.env.APP_URL || '') + '/admin/scan/' + qrToken;
}

// returns an <svg> string, small enough for slow connections
function qrSvg(qrToken) {
  return QRCode.toString(scanUrl(qrToken), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

module.exports = { scanUrl, qrSvg };
