import test from 'node:test';
import assert from 'node:assert/strict';
import {largeFixture} from './tax-large-fixture.mjs';
import {prepareTaxDatasetV3} from './tax-ready-dataset-v3.js';
import {DOCUMENT_LOGO} from './document-branding.js';
import {sha256} from './tax-evidence.js';

test('v3 retains the v2 original codec, row counts and every receipt hash', async()=>{
 const {env,DB}=await largeFixture(2);
 try{
  const snapshot=await prepareTaxDatasetV3(env,2025);
  const entries=[];
  for await(const entry of snapshot.entries())entries.push(entry);
  const manifest=JSON.parse(entries.at(-1).content);
  assert.equal(manifest.schema_version,3);
  assert.equal(manifest.counts.orders,2);
  assert.equal(manifest.document_encoding.name,'shared-logo-v1');
  const originals=manifest.files.filter(file=>file.encoding);
  assert.equal(originals.length,10);
  for(const spec of originals){
   const value=entries.find(entry=>entry.path===spec.path).content;
   const original=spec.encoding==='shared-logo-v1'?value.split(manifest.document_encoding.reference).join(DOCUMENT_LOGO):value;
   assert.equal(await sha256(original),spec.original_sha256);
   assert.equal(new TextEncoder().encode(original).length,spec.original_bytes);
  }
 }finally{DB.raw.close();}
});
