import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paketFuerArtikel, VERSAND } from './versand-config.js';

test('Merchant shipping agrees with checkout package estimates and standard prices', () => {
  const items = ['T-Shirt', 'Coat', 'Boots', 'Pants', 'Bag', 'UNKNOWN'].flatMap(product_type =>
    [20, 98.99, 99, 600].flatMap(price => ['Cotton sample', 'Leder Fell Daunen'].map(title => ({product_type, price, title}))));
  const script = `import json,sys;from merchant_shipping import package_for_item,merchant_shipping_cents;from pathlib import Path;c=json.loads(Path('config/shop-config.json').read_text(encoding='utf-8'));print(json.dumps([[package_for_item(i,c),merchant_shipping_cents(i,c)] for i in json.loads(sys.stdin.read())]))`;
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const actual = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',script], {cwd,input:JSON.stringify(items),encoding:'utf8'}));
  const expected = items.map(item => {
    const size = paketFuerArtikel([item]);
    const value = Math.round(item.price*100);
    const prices = VERSAND.tarife.filter(t => t.art==='standard' && t.zone==='DE' && value >= (t.abWarenwertCents || 0)).map(t => t.preise[size]);
    return [size,value >= VERSAND.versandkostenfrei.abCents ? 0 : Math.min(...prices)];
  });
  assert.deepEqual(actual,expected);
});

test('Merchant shipping lists every checkout country with the checkout price and transit time', async () => {
  const { festeOptionen, versandkostenfreiAnwenden } = await import('./versand.js');
  const { lieferlaender, zoneFuerLand } = await import('./versand-config.js');
  const items = ['T-Shirt', 'Coat', 'Boots', 'Bag'].flatMap(product_type =>
    [20, 99, 600, 1500].map(price => ({product_type, price, title: product_type === 'Coat' ? 'Leder Mantel' : 'Cotton sample'})));
  const script = `import json,sys;from merchant_shipping import merchant_shipping_entries;from pathlib import Path;c=json.loads(Path('config/shop-config.json').read_text(encoding='utf-8'));print(json.dumps([merchant_shipping_entries(i,c) for i in json.loads(sys.stdin.read())]))`;
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const actual = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',script], {cwd,input:JSON.stringify(items),encoding:'utf8'}));
  items.forEach((item, index) => {
    const value = Math.round(item.price*100);
    const size = paketFuerArtikel([item]);
    const expected = lieferlaender().map(land => {
      const zone = zoneFuerLand(land).key;
      const angebot = versandkostenfreiAnwenden({ paket: size, zone, optionen: festeOptionen(size, VERSAND, land) }, value);
      const best = angebot.optionen.filter(o => o.art === 'standard').sort((a, b) => a.preisCents - b.preisCents)[0];
      return { country: land, cents: best.preisCents, min_transit_time: best.laufzeitVon, max_transit_time: best.laufzeitBis };
    });
    assert.deepEqual(actual[index].map(e => ({ country: e.country, cents: e.cents, min_transit_time: e.min_transit_time, max_transit_time: e.max_transit_time })),
      expected, `${item.product_type} ${item.price}`);
    for (const e of actual[index]) assert.deepEqual([e.min_handling_time, e.max_handling_time], [1, 3]);
  });
  // Deutschland ab 99 EUR kostenlos, die EU zahlt immer den DHL-Preis.
  assert.equal(actual[1].find(e => e.country === 'DE').cents, 0);
  assert.ok(actual[1].find(e => e.country === 'FR').cents > 0);
});
