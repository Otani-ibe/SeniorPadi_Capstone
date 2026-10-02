// Nigerian mobile numbers are 11 digits and start with 070, 071, 080, 081, 090 or 091.
const LOCAL_PATTERN = /^0(70|71|80|81|90|91)\d{8}$/;

// Turns 08031234567 (or +2348031234567 / 2348031234567) into +2348031234567.
// Returns null if it isn't a valid Nigerian mobile number.
function normalizePhone(input) {
  if (!input) return null;
  let value = String(input).replace(/[\s-]/g, ''); // allow spaces and dashes, nothing else

  // turn the international form back into the 11-digit local form
  if (value.startsWith('+234')) value = '0' + value.slice(4);
  else if (value.startsWith('234') && value.length === 13) value = '0' + value.slice(3);

  if (!LOCAL_PATTERN.test(value)) return null;
  return '+234' + value.slice(1);
}

// Says what's wrong, so the error message can be specific
function phoneProblem(input) {
  const value = String(input || '').replace(/[\s-]/g, '');
  if (!value) return 'empty';
  if (/[^\d+]/.test(value)) return 'letters';
  if (normalizePhone(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 11) return 'short';
  if (digits.length > 11 && !value.startsWith('+234') && !value.startsWith('234')) return 'long';
  return 'start';
}

module.exports = { normalizePhone, phoneProblem, LOCAL_PATTERN };