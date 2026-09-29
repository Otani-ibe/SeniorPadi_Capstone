const en = require('../../locales/en.json');
const yo = require('../../locales/yo.json');

const locales = { en, yo };

// t('events.title', 'yo', { name: 'Ade' })
// falls back to English if a Yoruba string is missing
function t(key, lang, vars = {}) {
  let text = (locales[lang] && locales[lang][key]) || en[key] || key;
  for (const name of Object.keys(vars)) {
    text = text.split('{' + name + '}').join(vars[name]);
  }
  return text;
}

module.exports = { t };
