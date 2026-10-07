import test from 'node:test';
import assert from 'node:assert/strict';
import edge,{publicPath,publicCatalog} from './storefront-edge.js';

test('publication allows real shop, language, image, PWA and Apple Pay paths',()=>{
  for(const path of ['/','/en/','/fr/agb/','/artikel/119/index.html','/artikel/119.html','/kasse/','/assets/img/test/0.webp','/assets/legal-content.js','/manifest.webmanifest','/.well-known/apple-developer-merchantid-domain-association']) assert.equal(publicPath(path),true,path);
});
test('publication rejects backend sources, drafts metadata, configuration and traversal',()=>{
  for(const path of ['/shop-worker/worker.js','/shop-worker/wrangler.toml','/.git/config','/config/shop-config.json','/data/catalog-taxonomy-report.json','/admin/index.html','/scripts/example.py','/assets/a.test.js','/assets/%252e%252e/secret.js','/assets/a\\b.js']) assert.equal(publicPath(path),false,path);
});
test('only public records and approved simple fields leave the origin',()=>{
  assert.deepEqual(publicCatalog([{id:1,public_status:'AVAILABLE',title:'A',purchase_price:20,nested:{private:1},gallery:['assets/a.webp']},{id:2,public_status:'DRAFT',title:'Hidden'},{id:3,public_status:'SOLD',title:{private:1}}]),[{id:1,public_status:'AVAILABLE',title:'A',gallery:['assets/a.webp']},{id:3,public_status:'SOLD'}]);
});
test('photo brightness for the light view reaches the browser',()=>{
  // foto_hell (build_site.py) steuert die Aufhellung je Foto in der hellen Ansicht.
  assert.deepEqual(publicCatalog([{id:7,public_status:'AVAILABLE',foto_hell:1.25,taxonomy_reviewed:true}]),[{id:7,public_status:'AVAILABLE',foto_hell:1.25}]);
});
test('static body is preserved and payment-compatible security headers are present',async()=>{
  const html='<html><script>window.publicConfig={}</script><p>Shop</p></html>';
  const response=await edge.fetch(new Request('https://disorder119.com/kasse/'),{}, {},async()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
  assert.equal(await response.text(),html);
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(response.headers.get('Content-Security-Policy-Report-Only'),/paypal/);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(response.headers.get('Permissions-Policy'),/payment=\(self/);
});
test('public catalog HEAD and conditional requests cannot resurrect raw drafts',async()=>{
  let seen;
  const response=await edge.fetch(new Request('https://disorder119.com/data/items.json',{method:'HEAD',headers:{'If-None-Match':'old-private'}}),{},{},async req=>{seen=req;return new Response(JSON.stringify([{id:1,public_status:'DRAFT'}]));});
  assert.equal(seen.method,'GET');assert.equal(seen.headers.has('If-None-Match'),false);
  assert.equal(await response.text(),'');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('blocked paths never reach the origin and writes never reach static hosting',async()=>{
  let calls=0;
  const fetch=async()=>{calls++;return new Response('bad');};
  assert.equal((await edge.fetch(new Request('https://disorder119.com/shop-worker/worker.js'),{},{},fetch)).status,404);
  assert.equal((await edge.fetch(new Request('https://disorder119.com/',{method:'POST'}),{},{},fetch)).status,405);
  assert.equal(calls,0);
});
