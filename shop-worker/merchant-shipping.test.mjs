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
    const prices = VERSAND.tarife.filter(t => t.art==='standard' && value >= (t.abWarenwertCents || 0)).map(t => t.preise[size]);
    return [size,value >= VERSAND.versandkostenfrei.abCents ? 0 : Math.min(...prices)];
  });
  assert.deepEqual(actual,expected);
});
