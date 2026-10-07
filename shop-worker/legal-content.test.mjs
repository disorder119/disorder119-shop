import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CONTRACT_HTML,LEGAL_VERSION} from './legal-content.js';
import {formatOrderConfirmation} from './customer-mail.js';

test('website, translations and contract email share the reviewed canonical source',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../config/legal-content.json',import.meta.url),'utf8'));
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../assets/legal-content.js',import.meta.url),'utf8'),context);
  const app=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const end='/* D119_CANONICAL_LEGAL_END */';
  assert.equal(app.split('/* D119_CANONICAL_LEGAL_BEGIN */').length,2);
  const bundled={window:{}};
  vm.runInNewContext(app.slice(0,app.indexOf(end)+end.length),bundled);
  assert.equal(JSON.stringify(bundled.window.D119Legal),JSON.stringify(context.window.D119Legal));
  assert.equal(LEGAL_VERSION,source.version); assert.equal(CONTRACT_HTML,source.legal.legalAgbHtml.de);
  for(const lang of ['de','en','fr']) {
    assert.equal(context.window.D119Legal[lang].legalAgbHtml,source.legal.legalAgbHtml[lang]);
    assert.equal(context.window.D119Legal[lang].legalDatenschutzHtml,source.legal.legalDatenschutzHtml[lang]);
    assert.match(source.legal.legalDatenschutzHtml[lang],/PayPal/);
    assert.match(source.legal.legalDatenschutzHtml[lang],/Apple/);
    assert.match(source.legal.legalDatenschutzHtml[lang],/BayLDA/);
  }
});
test('confirmation contains full terms and withdrawal form in HTML and plain text',()=>{
  const mail=formatOrderConfirmation({order_number:'SYNTHETIC-1',items:[{title:'Test',article_no:'119-1',unit_price_cents:100}],subtotal_cents:100,total_cents:100},{contactEmail:'office@example.test',zahlung:'RESERVIERT'});
  for(const body of [mail.text,mail.html]) {
    assert.match(body,/Geltungsbereich/); assert.match(body,/Bestellung und Vertragsschluss/);
    assert.match(body,/Gewährleistung/);assert.match(body,/Muster-Widerrufsformular/);
    assert.match(body,/2026-10-07/);assert.match(body,/\+49 152 0829 7741/);assert.match(body,/office@example.test/);
    assert.doesNotMatch(body,/\{email\}/);
  }
  assert.doesNotMatch(mail.text,/<h3>/);
});
