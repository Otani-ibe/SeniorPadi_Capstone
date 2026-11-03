// Translates staff and senior text (event titles, descriptions, bios) to Yorùbá with Google Cloud Translation.
// saved in Translations so each text is translated once. Buttons and menus use locales/yo.json
const crypto = require('crypto');
const { Translation } = require('../models');

const API_URL = 'https://translation.googleapis.com/language/translate/v2';

function isOn() {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY);
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// texts: strings -> translated strings, same order. On any failure the English comes back, pages never break
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

// adds .tTitle, .tDescription, .tImageAlt to each event, originals stay
async function translateEvents(events, lang) {
  const list = events.filter(Boolean);
  const texts = [];
  list.forEach((e) => texts.push(e.title, e.description, e.imageAlt || ''));
  const out = await translateTexts(texts, lang);
  list.forEach((e, i) => {
    e.tTitle = out[i * 3];
    e.tDescription = out[i * 3 + 1];
    e.tImageAlt = out[i * 3 + 2];
  });
  return events;
}

module.exports = { isOn, translateTexts, translateEvents };
