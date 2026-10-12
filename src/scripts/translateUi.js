// Fills in locales/yo.json from locales/en.json using the Google Cloud Translation API.
//   npm run translate:ui          -> only translates text that's missing in yo.json
//   npm run translate:ui -- --all -> translates everything again (overwrites yo.json)
// Needs GOOGLE_TRANSLATE_API_KEY in .env. A Yorùbá speaker should still read the result.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const EN_FILE = path.join(__dirname, '../../locales/en.json');
const YO_FILE = path.join(__dirname, '../../locales/yo.json');
const API_URL = 'https://translation.googleapis.com/language/translate/v2';

// keep {name}, {date} and so on exactly as they are
function protect(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{(\w+)\}/g, '<span class="notranslate">{$1}</span>')
    .replace(/\n/g, '<br>');
}
function unprotect(html) {
  return html
    .replace(/<span class="notranslate">\s*(\{\w+\})\s*<\/span>/g, '$1')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function translateBatch(texts) {
  const res = await fetch(API_URL + '?key=' + encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: texts.map(protect), source: 'en', target: 'yo', format: 'html' })
  });
  if (!res.ok) throw new Error('Google Translate said ' + res.status + ': ' + (await res.text()));
  const data = await res.json();
  return data.data.translations.map((t) => unprotect(t.translatedText));
}

async function main() {
  if (!process.env.GOOGLE_TRANSLATE_API_KEY) {
    console.log('Add GOOGLE_TRANSLATE_API_KEY to .env first.');
    process.exit(1);
  }
  const all = process.argv.includes('--all');
  const en = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
  const yo = JSON.parse(fs.readFileSync(YO_FILE, 'utf8'));

  const keys = Object.keys(en).filter((k) => all || !yo[k]);
  if (keys.length === 0) {
    console.log('Nothing to translate. yo.json already has every line.');
    return;
  }

  // the API takes up to 128 lines at a time
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const out = await translateBatch(chunk.map((k) => en[k]));
    chunk.forEach((k, j) => { yo[k] = out[j]; });
    console.log('Translated ' + Math.min(i + 100, keys.length) + ' of ' + keys.length);
  }

  // same order as en.json, so the two files are easy to compare
  const ordered = {};
  for (const k of Object.keys(en)) if (yo[k]) ordered[k] = yo[k];
  fs.writeFileSync(YO_FILE, JSON.stringify(ordered, null, 2) + '\n');
  console.log('Saved locales/yo.json. Ask a Yorùbá speaker to read the new lines.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
