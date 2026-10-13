import test from 'node:test';
import assert from 'node:assert/strict';
import {largeFixture} from './tax-large-fixture.mjs';
import {prepareTaxDatasetV3,combineAccountingLedger,buildAccountingYearSummary} from './tax-ready-dataset-v3.js';

test('v3 private and operational metadata use the same cut as order originals',async()=>{
 const {env,DB}=await largeFixture(1),batch=DB.batch.bind(DB);
 let injected=false;
 DB.batch=async statements=>{
  const result=await batch(statements);
  if(!injected){
   injected=true;
   DB.raw.exec("INSERT INTO tax_accounts(id,name,kind,currency,created_at) VALUES('late-account','Later account','CASH','EUR','2025-12-01')");
   DB.raw.exec("UPDATE inventory SET article_no='LATE-NUMBER' WHERE item_id=1");
  }
  return result;
 };
 try{
  const first=await prepareTaxDatasetV3(env,2025);
  assert.equal(first.tables.accounts.length,0,'Later accounting rows must not enter an older order snapshot');
  assert.deepEqual(first.itemLinks[0].article_numbers,['A-0'],'Operational references must come from the same cut');
  const second=await prepareTaxDatasetV3(env,2025);
  assert.equal(second.tables.accounts.length,1,'The next export includes the later row');
  assert.ok(second.itemLinks[0].article_numbers.includes('LATE-NUMBER'));
 }finally{DB.raw.close();}
});

test('manual copies cannot replace provider proof with another amount, year or order',()=>{
 const provider=[{id:'verified',kind:'capture',provider:'PAYPAL',provider_reference:'capture1',amount_cents:6000,
  currency:'EUR',occurred_at:'2025-12-20T10:00:00Z',book_date:'2025-12-20',order_id:'order1',blocks:[]}];
 for(const changed of [{amount_cents:9000},{occurred_at:'2026-01-01T10:00:00Z'},{direction:'OUT'},{order_id:'other'}]){
  const manual=[{id:'manual',event_type:'SALE_INCOME',direction:'IN',provider:'PAYPAL',provider_reference:'capture1',
   amount_cents:6000,currency:'EUR',occurred_at:'2025-12-20T10:00:00Z',order_id:'order1',...changed}];
  const combined=combineAccountingLedger(manual,provider);
  assert.equal(combined.length,1);assert.equal(combined[0].id,'provider:verified');
  const summary=buildAccountingYearSummary({ledger_events:manual,purchases:[],expense_events:[]},2025,provider);
  assert.equal(summary.sale_income_cents,6000);
  assert.equal(manual[0].id,'manual','Original manual input remains available for review');
 }
});
