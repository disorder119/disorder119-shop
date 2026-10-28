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
    assert.match(body,/2026-10-28-3/);assert.match(body,/\+49 152 0829 7741/);assert.match(body,/office@example.test/);
    assert.doesNotMatch(body,/\{email\}/);
  }
  assert.doesNotMatch(mail.text,/<h3>/);
});

test('withdrawal keeps the statutory period, return costs and refund proof in all languages',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../config/legal-content.json',import.meta.url),'utf8'));
  for(const [lang,receipt,cost,noExtra,defects] of [
    ['de',/letzte Ware deiner Bestellung/,/Du trägst die unmittelbaren Kosten der Rücksendung/,/keine freiwillige verlängerte Rückgabefrist/,/Mängelrechte/],
    ['en',/last item in your order/,/bear the direct cost of returning/,/do not offer a voluntary extended return period/,/defective goods/],
    ['fr',/dernier article de ta commande/,/frais directs de renvoi/,/aucun délai de retour volontaire prolongé/,/droits légaux en cas de défaut/],
  ]) {
    const legal=source.legal.legalAgbHtml[lang];
    for(const rule of [receipt,cost,noExtra,defects])assert.match(legal,rule,lang);
  }
  assert.match(CONTRACT_HTML,/unverzüglich und spätestens binnen vierzehn Tagen/);
  assert.match(CONTRACT_HTML,/Nachweis erbracht hast.*je nachdem, welches der frühere Zeitpunkt ist/);
  assert.match(CONTRACT_HTML,/einschließlich der Lieferkosten/);
  const checkout=fs.readFileSync(new URL('../kasse_template.html',import.meta.url),'utf8');
  assert.ok(checkout.indexOf('id="kasseRueckgabe"')<checkout.indexOf('id="kasseZahlen"'));
});

test('privacy policy names the visit summary, the visit count in browser storage, regional blocking and the 24-hour attack blocks in all languages',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../config/legal-content.json',import.meta.url),'utf8'));
  assert.equal(source.version,'2026-10-28-3');
  for(const [lang,stand,zusammenfassung,sperre,waechter] of [
    ['de',/Stand: 28\. Oktober 2026/,/Zusammenfassung per Telegram/,/Länder-Sperre/,/für 24 Stunden/],
    ['en',/Updated 28 October 2026/,/Telegram summary/,/Regional blocking/,/for 24 hours/],
    ['fr',/Mise à jour : 28 octobre 2026/,/résumé Telegram/,/Blocage régional/,/pendant 24 heures/],
  ]) {
    const text=source.legal.legalDatenschutzHtml[lang];
    for(const rule of [stand,zusammenfassung,sperre,waechter,/d119_besuche_v1/,/utm_source/])assert.match(text,rule,lang);
    assert.doesNotMatch(text,/(?:Bei einem neuen Besuch|For a new visit|Pour une nouvelle visite)/,lang+': old instant notification text removed');
  }
});
