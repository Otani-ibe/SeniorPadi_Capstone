// Turns 0803 123 4567, 2348031234567 or +2348031234567 into +2348031234567
// Returns null if it doesn't look like a Nigerian mobile number
function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, '');

  if (digits.startsWith('+234')) digits = digits.slice(4);
  else if (digits.startsWith('234')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  if (!/^[789]\d{9}$/.test(digits)) return null;
  return '+234' + digits;
}

module.exports = { normalizePhone };
