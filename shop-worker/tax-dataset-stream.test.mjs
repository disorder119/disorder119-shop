import test from 'node:test';
import assert from 'node:assert/strict';
import {largeFixture} from './tax-large-fixture.mjs';
import {prepareDataset,LOGO_REFERENCE} from './tax-dataset-stream.js';
import {DOCUMENT_LOGO} from './document-branding.js';
import {sha256} from './tax-evidence.js';

test('v2 preserves every original byte while sharing the offline logo',async()=>{
 const {env,DB}=await largeFixture(2),d=await prepareDataset(env,2025),entries=[];
 for await(const e of d.entries())entries.push(e);
 const m=JSON.parse(entries.at(-1).content);assert.equal(m.schema_version,2);
 for(const spec of m.files){
  const content=entries.find(e=>e.path===spec.path).content;
  if(spec.encoding){const original=spec.encoding==='shared-logo-v1'?content.split(LOGO_REFERENCE).join(DOCUMENT_LOGO):content;assert.equal(await sha256(original),spec.original_sha256);assert.equal(new TextEncoder().encode(original).length,spec.original_bytes);}
 }
 assert.equal(entries.filter(e=>e.path.startsWith('invoices/')).length,4);
 assert.equal(entries.filter(e=>e.path.startsWith('confirmations/')).length,6);
 const invoice=DB.raw.prepare('SELECT html FROM rechnungen ORDER BY id').get();
 const compact=entries.find(e=>e.path.startsWith('invoices/')&&e.path.endsWith('.html')).content;
 assert.equal(compact.split(LOGO_REFERENCE).join(DOCUMENT_LOGO),invoice.html);
 assert.ok(compact.length<invoice.html.length/5);
 DB.raw.close();
});
test('summary and stream cancellation do not fetch all document bodies',async()=>{
 const {env,DB}=await largeFixture(3);let reads=0;const prepare=DB.prepare.bind(DB);
 DB.prepare=sql=>{if(sql.startsWith('WITH codec'))reads++;return prepare(sql);};
 const d=await prepareDataset(env,2025);assert.equal(reads,0);
 const reader=d.stream().getReader();await reader.read();await reader.cancel();assert.equal(reads,0);DB.raw.close();
});
test('changed archived original fails the stream instead of yielding a complete ZIP',async()=>{
 const {env,DB}=await largeFixture(1),d=await prepareDataset(env,2025);
 DB.raw.exec("DROP TRIGGER trg_rechnung_unveraenderlich;UPDATE rechnungen SET html=html||'tampered'");
 await assert.rejects(()=>new Response(d.stream()).arrayBuffer(),/ORIGINAL_HASH_MISMATCH/);DB.raw.close();
});
test('literal reference collisions are retained without substitution',async()=>{
 const {env,DB}=await largeFixture(1);DB.raw.exec('DROP TRIGGER trg_rechnung_unveraenderlich');
 const row=DB.raw.prepare('SELECT id,html FROM rechnungen').get(),html=row.html+LOGO_REFERENCE;
 DB.raw.prepare('UPDATE rechnungen SET html=?,html_sha256=? WHERE id=?').run(html,await sha256(html),row.id);
 const d=await prepareDataset(env,2025);for await(const _ of d.entries()){}
 const spec=d.manifest.files.find(f=>f.path.startsWith('invoices/')&&f.path.endsWith('.html'));
 assert.equal(spec.encoding,'identity');assert.equal(spec.original_sha256,await sha256(html));DB.raw.close();
});
test('a vanished snapshot member fails rather than silently truncating history',async()=>{
 const {env,DB}=await largeFixture(1),d=await prepareDataset(env,2025);
 DB.raw.exec('DROP TRIGGER trg_rechnung_nicht_loeschbar;DELETE FROM rechnungen');
 await assert.rejects(()=>new Response(d.stream()).arrayBuffer(),/ORIGINAL_MISSING/);DB.raw.close();
});

test('new orders cannot change an in-flight snapshot',async()=>{
 const {env,DB}=await largeFixture(1),d=await prepareDataset(env,2025);
 DB.raw.exec("INSERT INTO commerce_orders(id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at) VALUES('late','late','RESERVED','EUR',100,0,100,'late','2025-12-01')");
 for await(const _ of d.entries()){}
 assert.equal(d.manifest.counts.orders,1);assert.equal((await prepareDataset(env,2025)).summary.orders,2);DB.raw.close();
});
test('download route streams a complete private ZIP and requires authentication',async()=>{
 const {handleBuchhaltung}=await import('./buchhaltung.js');const {env,DB}=await largeFixture(1);
 const url=new URL('https://example.com/admin/buchhaltung/datensatz.zip?jahr=2025'),origin='https://admin.disorder119.com';
 assert.equal((await handleBuchhaltung(new Request(url),{...env,ADMIN_TOKEN:'synthetic'},url,'test',origin)).status,401);
 const response=await handleBuchhaltung(new Request(url,{headers:{Origin:origin,Authorization:'Bearer synthetic'}}),{...env,ADMIN_TOKEN:'synthetic'},url,'test',origin);
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Type'),'application/zip');
 const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(-22,-18)],[80,75,5,6]);DB.raw.close();
});
