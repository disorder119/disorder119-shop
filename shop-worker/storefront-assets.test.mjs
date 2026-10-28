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

test('directory indexes and exact verification HTML keep their original public URLs', async () => {
  const paths = [];
  const env = assetEnv(async req => {
    paths.push(new URL(req.url).pathname);
    return new Response('original', { headers: { 'Content-Type': 'text/html' } });
  });
  for (const [path, asset] of [['/', '/index.html'], ['/en/', '/en/index.html'],
      ['/artikel/119/', '/artikel/119/index.html'], ['/kasse/', '/kasse/index.html'],
      ['/google7945c4dc594a9a9c.html', '/google7945c4dc594a9a9c.html'],
      ['/.well-known/apple-developer-merchantid-domain-association', '/.well-known/apple-developer-merchantid-domain-association']]) {
    const r = await worker.fetch(request(path), env, {});
    assert.equal(r.status, 200, path);
    assert.equal(paths.at(-1), asset);
  }
  const r = await worker.fetch(request('/faq?source=old'), env, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://disorder119.com/faq/?source=old');
  assert.equal(paths.at(-1), '/faq/index.html');
});

test('legal pages and files with the owner address stay reachable but carry X-Robots-Tag noindex', async () => {
  const env = assetEnv(async req => new URL(req.url).pathname.endsWith('.js')
    ? new Response('window.D119Legal={};', { headers: { 'Content-Type': 'text/javascript' } })
    : new Response('<html><p>Impressum</p></html>', { headers: { 'Content-Type': 'text/html' } }));
  const robots = 'noindex, noarchive, nosnippet, noimageindex';
  for (const path of ['/impressum/', '/agb/', '/datenschutz/', '/widerruf/', '/en/impressum/', '/en/agb/',
    '/en/datenschutz/', '/en/widerruf/', '/fr/impressum/', '/fr/agb/', '/fr/datenschutz/', '/fr/widerruf/',
    '/impressum/index.html', '/assets/app.js', '/assets/legal-content.js']) {
    const r = await worker.fetch(request(path), env, {});
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('X-Robots-Tag'), robots, path);
  }
  for (const path of ['/', '/en/', '/faq/', '/ueber-uns/', '/kasse/', '/artikel/12/', '/assets/article.js', '/data/catalog.json']) {
    const r = await worker.fetch(request(path), assetEnv(async () => path.endsWith('.json')
      ? Response.json([]) : new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })), {});
    assert.equal(r.headers.get('X-Robots-Tag'), null, path);
  }
});
test('content-hashed scripts and styles become immutable only when the bytes match the hash', async () => {
  const css = new TextEncoder().encode('body{color:red}');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', css)), b => b.toString(16).padStart(2, '0')).join('');
  let seen;
  const env = assetEnv(async req => {
    seen = req;
    return new Response(css, { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: 'x' } });
  });
  let r = await worker.fetch(request('/assets/app.css?v=' + digest.slice(0, 10), { headers: { 'If-None-Match': 'x' } }), env, {});
  assert.equal(r.status, 200);
  assert.equal(seen.headers.has('If-None-Match'), false);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), css);
  // Wrong, manual or extended version values keep the revalidating default.
  for (const path of ['/assets/app.css?v=0123456789', '/assets/site-lock.js?v=20261008-1',
      '/assets/app.css?v=' + digest.slice(0, 10) + '&x=1', '/assets/app.css']) {
    r = await worker.fetch(request(path), env, {});
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate', path);
  }
});

test('images are cached briefly, the catalog keeps no-store', async () => {
  const env = assetEnv(async req => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('.html')) return new Response('<html><body>x</body></html>', { headers: { 'Content-Type': 'text/html' } });
    if (path.endsWith('.json')) return Response.json([]);
    return new Response('img', { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  });
  let r = await worker.fetch(request('/assets/img/9479/thumbs/0.webp'), env, {});
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=600');
  r = await worker.fetch(request('/assets/img/9479/thumbs/0.webp'), assetEnv(async () => new Response(null, { status: 304 })), {});
  assert.equal(r.status, 304);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=600');
  r = await worker.fetch(request('/assets/img/missing.webp'), assetEnv(async () => new Response('x', { status: 404 })), {});
  assert.notEqual(r.headers.get('Cache-Control'), 'public, max-age=600');
  r = await worker.fetch(request('/data/catalog.json'), env, {});
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('shop pages allow the back/forward cache and announce same-language prefetch rules; checkout never', async () => {
  const env = assetEnv(async req => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('.json')) return new Response('{"prefetch":[]}', { headers: { 'Content-Type': 'application/json' } });
    return new Response('<html><body>x</body></html>', { headers: { 'Content-Type': 'text/html' } });
  });
  for (const [path, regeln] of [['/', '/assets/spekulation-de.json'], ['/artikel/119/', '/assets/spekulation-de.json'],
      ['/en/', '/assets/spekulation-en.json'], ['/fr/artikel/119/', '/assets/spekulation-fr.json'], ['/faq/', '/assets/spekulation-de.json']]) {
    const r = await worker.fetch(request(path), env, {});
    assert.equal(r.headers.get('Cache-Control'), 'private, no-cache', path);
    assert.equal(r.headers.get('Speculation-Rules'), '"' + regeln + '"', path);
    assert.match(r.headers.get('Content-Security-Policy'), /script-src 'self'/, path);
  }
  for (const path of ['/kasse/', '/en/kasse/', '/konto/', '/cart/', '/fr/cart/', '/widerruf/', '/newsletter/']) {
    const r = await worker.fetch(request(path), env, {});
    assert.equal(r.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(r.headers.get('Speculation-Rules'), null, path);
  }
  const missing = await worker.fetch(request('/artikel/999999/'), assetEnv(async () => new Response('<html>404</html>', { status: 404, headers: { 'Content-Type': 'text/html' } })), {});
  assert.notEqual(missing.headers.get('Cache-Control'), 'private, no-cache');
  const r = await worker.fetch(request('/assets/spekulation-en.json'), env, {});
  assert.equal(r.headers.get('Content-Type'), 'application/speculationrules+json');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=3600');
});
