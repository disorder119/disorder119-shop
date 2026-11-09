const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = source.indexOf('  // Englischer Shop:');
const end = source.indexOf('  var I18N =', start);
assert.ok(start >= 0 && end > start, 'archive localization block must be present');
const localization = source.slice(start, end);

function archive(lang, rows) {
  const context = { LANG: lang, ITEMS: JSON.parse(JSON.stringify(rows)) };
  vm.runInNewContext(localization, context);
  return context;
}

const row = {
  title: 'Prada Jacke Damen Schwarz', title_en: 'Prada Jacket Women Black',
  title_fr: 'Prada veste femme noire', color: 'Schwarz, Weiß',
  color_en: 'Black, White', color_fr: 'noir, blanc'
};

test('French archive cards/cart/modes receive maintained French titles and color labels', () => {
  const app = archive('fr', [row]);
  assert.equal(app.ITEMS[0].title, 'Prada veste femme noire');
  assert.equal(app.trColor('Schwarz, Weiß'), 'noir, blanc');
  assert.equal(app.ITEMS[0].color, 'Schwarz, Weiß', 'filter identity remains stable');
});

test('English and German behavior remains consistent', () => {
  const english = archive('en', [row]);
  assert.equal(english.ITEMS[0].title, row.title_en);
  assert.equal(english.trColor(row.color), row.color_en);
  const german = archive('de', [row]);
  assert.equal(german.ITEMS[0].title, row.title);
  assert.equal(german.trColor(row.color), row.color);
});

test('missing or mismatched translations preserve data without assigning the wrong color', () => {
  const app = archive('fr', [{ title: 'Archive item', color: 'Schwarz, Weiß', color_fr: 'noir' }]);
  assert.equal(app.ITEMS[0].title, 'Archive item');
  assert.equal(app.trColor('Schwarz, Weiß'), 'Schwarz, Weiß');
  assert.equal(app.trColor(''), '');
});
