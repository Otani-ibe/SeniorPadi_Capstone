const { normalizePhone, phoneProblem } = require('../src/services/phone');

test('accepts 11-digit Nigerian mobile numbers', () => {
  expect(normalizePhone('08031234567')).toBe('+2348031234567');
  expect(normalizePhone('09161234567')).toBe('+2349161234567');
  expect(normalizePhone('0803 123 4567')).toBe('+2348031234567');
  expect(normalizePhone('+2348031234567')).toBe('+2348031234567');
});

test('rejects letters, wrong length and wrong starts', () => {
  expect(normalizePhone('0803abc4567')).toBeNull();
  expect(normalizePhone('0803123456')).toBeNull(); // 10 digits
  expect(normalizePhone('080312345678')).toBeNull(); // 12 digits
  expect(normalizePhone('06031234567')).toBeNull(); // not a mobile prefix
  expect(normalizePhone('')).toBeNull();
});

test('says what the problem is', () => {
  expect(phoneProblem('0803abc4567')).toBe('letters');
  expect(phoneProblem('0803123')).toBe('short');
  expect(phoneProblem('080312345678')).toBe('long');
  expect(phoneProblem('06031234567')).toBe('start');
  expect(phoneProblem('08031234567')).toBeNull();
});
