import test from 'node:test';
import assert from 'node:assert/strict';
import {largeFixture} from './tax-large-fixture.mjs';
import {prepareTaxDatasetV3} from './tax-ready-dataset-v3.js';

test('100 paid orders export complete original receipts and stable payment counts',async()=>{
 const {env,DB,expectedEvents}=await largeFixture(100);
 try{
  const dataset=await prepareTaxDatasetV3(env,2025);
  const bytes=new Uint8Array(await new Response(dataset.stream()).arrayBuffer());
  assert.equal(dataset.manifest.counts.orders,100);
  assert.equal(dataset.manifest.counts.invoices,100);
  assert.equal(dataset.manifest.counts.cash_events,expectedEvents);
  assert.equal(dataset.manifest.files.filter(f=>f.path.startsWith('invoices/')).length,200);
  assert.deepEqual([...bytes.slice(-22,-18)],[80,75,5,6]);
 }finally{DB.raw.close();}
});
