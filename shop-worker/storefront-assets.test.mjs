import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './storefront-assets.js';

const request = (path, init) => new Request('https://disorder119.com' + path, init);
const assetEnv = (fetch) => ({ ASSETS: { fetch }, RELEASE_SHA: 'a'.repeat(40) });

test('missing assets fail closed without a fetch to GitHub or another origin', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network fallback'); };
  try {
    assert.equal((await worker.fetch(request('/'), {}, {})).status, 503);
    const head = await worker.fetch(request('/', { method: 'HEAD' }), {}, {});
    assert.equal(head.status, 503);
    assert.equal(await head.text(), '');
  } finally { globalThis.fetch = old; }
});

test('public page and existing payment/API links survive the hosting move', async () => {
  const html = '<html><a href="https://api.disorder119.com/ebay/return">eBay</a>' +
    '<script src="https://www.paypal.com/sdk/js?client-id=public"></script></html>';
  const r = await worker.fetch(request('/kasse/'), assetEnv(async () => new Response(html,
    { headers: { 'Content-Type': 'text/html' } })), {});
  assert.equal(r.status, 200);
  assert.equal(await r.text(), html);
  assert.match(r.headers.get('Content-Security-Policy'), /https:\/\/api.disorder119.com/);
  assert.match(r.headers.get('Content-Security-Policy'), /paypal/);
  assert.equal(r.headers.get('X-Disorder119-Hosting'), 'cloudflare-assets');
  assert.equal(r.headers.get('X-Disorder119-Release'), 'a'.repeat(40));
});

test('private files, writes, unknown hosts and legacy IDs never reach asset storage', async () => {
  let calls = 0;
  const env = assetEnv(async () => { calls++; return new Response('wrong'); });
  for (const path of ['/config/shop-config.json', '/shop-worker/worker-entry.js', '/.git/config', '/admin/', '/assets/example.test.js']) {
    assert.equal((await worker.fetch(request(path), env, {})).status, 404, path);
  }
  assert.equal((await worker.fetch(request('/', { method: 'POST' }), env, {})).status, 405);
  assert.equal((await worker.fetch(new Request('https://unexpected.example/'), env, {})).status, 404);
  const r = await worker.fetch(request('/en/artikel/9472/?from=old'), env, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://disorder119.com/en/artikel/123/?from=old');
  assert.equal(calls, 0);
});

test('asset transport cannot expose draft rows or internal fields through catalog or HEAD', async () => {
  let seen;
  const env = assetEnv(async req => {
    seen = req;
    return Response.json([{ id: 1, public_status: 'AVAILABLE', article: '119', price: 120, purchase_price: 5 },
      { id: 2, public_status: 'DRAFT', title: 'private' }]);
  });
  const r = await worker.fetch(request('/data/catalog.json'), env, {});
  assert.deepEqual(await r.json(), [{ id: 1, public_status: 'AVAILABLE', article: '119', price: 120 }]);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const head = await worker.fetch(request('/data/items.json', {
    method: 'HEAD', headers: { Range: 'bytes=0-1', 'If-None-Match': 'old' },
  }), env, {});
  assert.equal(seen.method, 'GET');
  assert.equal(seen.headers.has('Range'), false);
  assert.equal(seen.headers.has('If-None-Match'), false);
  assert.equal(await head.text(), '');
});

test('images, asset redirects, cache validators and missing pages preserve status and bytes', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 255]);
  let r = await worker.fetch(request('/assets/img/a.webp'), assetEnv(async () => new Response(bytes,
    { headers: { 'Content-Type': 'image/webp', ETag: 'same-image' } })), {});
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  assert.equal(r.headers.get('ETag'), 'same-image');
  r = await worker.fetch(request('/assets/img/a.webp'), assetEnv(async () => new Response(null,
    { status: 304, headers: { ETag: 'same-image' } })), {});
  assert.equal(r.status, 304);
  r = await worker.fetch(request('/faq'), assetEnv(async () => new Response(null,
    { status: 307, headers: { Location: '/faq/' } })), {});
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('Location'), '/faq/');
  r = await worker.fetch(request('/artikel/999999/'), assetEnv(async () => new Response('missing', { status: 404 })), {});
  assert.equal(r.status, 404);
});
