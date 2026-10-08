import test from 'node:test';
import assert from 'node:assert/strict';
import edge,{publicPath,publicCatalog,seitenaufruf} from './storefront-edge.js';

test('publication allows real shop, language, image, PWA and Apple Pay paths',()=>{
  for(const path of ['/','/en/','/fr/agb/','/artikel/119/index.html','/artikel/119.html','/kasse/','/assets/img/test/0.webp','/assets/legal-content.js','/manifest.webmanifest','/.well-known/apple-developer-merchantid-domain-association','/feed/google-merchant.xml']) assert.equal(publicPath(path),true,path);
  for(const path of ['/feed/','/feed/google-merchant.json','/feed/x/y.xml']) assert.equal(publicPath(path),false,path);
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

const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const seite=(path,headers={},method='GET')=>new Request('https://disorder119.com'+path,{method,headers:{'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','User-Agent':IPHONE,'CF-Connecting-IP':'203.0.113.7',...headers}});
const zaehler=(antwort=()=>new Response(null,{status:204}))=>{
  const gesendet=[],laeuft=[];
  return {gesendet,laeuft,env:{BESUCH:{fetch:async(url,init)=>{gesendet.push({url,body:JSON.parse(init.body)});return antwort();}}},ctx:{waitUntil:p=>laeuft.push(p)}};
};
const html=async()=>new Response('<html><p>Shop</p></html>',{headers:{'Content-Type':'text/html'}});
test('real page views reach the shop Worker after the page, also while the shop is locked',async()=>{
  const z=zaehler();
  const response=await edge.fetch(seite('/artikel/119/',{Referer:'https://l.instagram.com/'}),z.env,z.ctx,html);
  assert.equal(response.status,200);assert.equal(await response.text(),'<html><p>Shop</p></html>');
  await Promise.all(z.laeuft);
  assert.equal(z.gesendet.length,1);
  assert.equal(z.gesendet[0].url,'https://storefront.intern/intern/seitenaufruf');
  assert.deepEqual(z.gesendet[0].body,{p:'/artikel/119/',r:'https://l.instagram.com/',ua:IPHONE,ip:'203.0.113.7',land:''});
  await edge.fetch(seite('/'),z.env,z.ctx,async()=>new Response(null,{status:304}));
  await Promise.all(z.laeuft);
  assert.equal(z.gesendet.length,2,'revalidated page still counts');
});
test('assets, data, prefetch, bots, privacy signals, objection cookie, errors and HEAD are never counted',async()=>{
  const z=zaehler();
  const nicht=[
    seite('/assets/app.js',{'Sec-Fetch-Dest':'script','Sec-Fetch-Mode':'no-cors'}),
    seite('/robots.txt'),seite('/manifest.webmanifest'),
    seite('/',{'Sec-Purpose':'prefetch;prerender'}),seite('/',{Purpose:'prefetch'}),
    seite('/',{'Sec-GPC':'1'}),seite('/',{DNT:'1'}),
    seite('/',{Cookie:'a=b; d119_nicht_zaehlen=1'}),
    seite('/',{},'HEAD'),
    new Request('https://disorder119.com/',{headers:{'User-Agent':'curl/8.0'}}),
    seite('/',{'Sec-Fetch-Dest':'iframe'}),
  ];
  for(const req of nicht) await edge.fetch(req,z.env,z.ctx,html);
  await edge.fetch(seite('/artikel/999999/'),z.env,z.ctx,async()=>new Response('fehlt',{status:404}));
  await Promise.all(z.laeuft);
  assert.equal(z.gesendet.length,0);
  assert.equal(seitenaufruf(seite('/',{Cookie:'d119_nicht_zaehlen=0'}),new URL('https://disorder119.com/'),200).p,'/');
});
test('a failing or missing visit counter never breaks the page',async()=>{
  const kaputt={BESUCH:{fetch:()=>{throw new Error('weg');}}};
  let response=await edge.fetch(seite('/'),kaputt,{waitUntil(){}},html);
  assert.equal(response.status,200);
  const abgelehnt=zaehler(()=>{throw new Error('weg');});
  response=await edge.fetch(seite('/'),abgelehnt.env,abgelehnt.ctx,html);
  await Promise.all(abgelehnt.laeuft);
  assert.equal(response.status,200);
  response=await edge.fetch(seite('/'),{},{},html);
  assert.equal(response.status,200);
});

test('plain http is redirected to https before anything else',async()=>{
  let calls=0;
  const response=await edge.fetch(new Request('http://disorder119.com/artikel/119/?a=1'),{},{},async()=>{calls++;return new Response('x');});
  assert.equal(response.status,301);assert.equal(response.headers.get('Location'),'https://disorder119.com/artikel/119/?a=1');assert.equal(calls,0);
  assert.match(response.headers.get('Strict-Transport-Security'),/max-age/);
});
test('an unknown address gets the designed 404 page without asking the origin',async()=>{
  let calls=0;
  const response=await edge.fetch(new Request('https://disorder119.com/gibtsnicht/'),{},{},async()=>{calls++;return new Response('x');});
  assert.equal(response.status,404);assert.equal(calls,0);
  assert.match(response.headers.get('Content-Type'),/text\/html/);
  const body=await response.text();assert.match(body,/<html lang="de">/);assert.match(body,/Seite nicht gefunden/);assert.match(body,/href="\/"/);
  const kopf=await edge.fetch(new Request('https://disorder119.com/gibtsnicht/',{method:'HEAD'}),{},{},async()=>{calls++;return new Response('x');});
  assert.equal(kopf.status,404);assert.equal(await kopf.text(),'');assert.equal(calls,0);
});
