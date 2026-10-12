// Translates text written by staff or seniors (event titles, descriptions, bios)
// into Yorùbá with the Google Cloud Translation API.
// Results are saved in the Translations table, so each text is only translated once.
// The buttons and menus use the reviewed text in locales/yo.json instead.
const crypto = require('crypto');
const { Translation } = require('../models');

const API_URL = 'https://translation.googleapis.com/language/translate/v2';

function isOn() {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY);
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// texts: array of strings. Returns an array of translated strings in the same order.
// If anything goes wrong, the original English is returned, so pages never break.
async function translateTexts(texts, targetLang) {
  if (targetLang === 'en' || !isOn()) return texts;

  const results = texts.slice();
  const missing = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    const saved = await Translation.findOne({ where: { sourceHash: hash(text), targetLang } });
    if (saved) results[i] = saved.translatedText;
    else missing.push(i);
  }
  if (missing.length === 0) return results;

  try {
    const res = await fetch(API_URL + '?key=' + encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: missing.map((i) => texts[i]), source: 'en', target: targetLang, format: 'text' })
    });
    if (!res.ok) throw new Error('Google Translate ' + res.status);
    const data = await res.json();

    for (let j = 0; j < missing.length; j++) {
      const i = missing[j];
      const translated = data.data.translations[j].translatedText;
      results[i] = translated;
      await Translation.findOrCreate({
        where: { sourceHash: hash(texts[i]), targetLang },
        defaults: { sourceText: texts[i], translatedText: translated }
      });
    }
  } catch (err) {
    console.error('Translation failed, showing English:', err.message);
  }
  return results;
}

// adds .tTitle and .tDescription to each event (the original stays in .title / .description)
async function translateEvents(events, lang) {
  const list = events.filter(Boolean);
  const texts = [];
  list.forEach((e) => texts.push(e.title, e.description));
  const out = await translateTexts(texts, lang);
  list.forEach((e, i) => {
    e.tTitle = out[i * 2];
    e.tDescription = out[i * 2 + 1];
  });
  return events;
}

module.exports = { isOn, translateTexts, translateEvents };
