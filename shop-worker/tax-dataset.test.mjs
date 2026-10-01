import test from 'node:test';
import assert from 'node:assert/strict';
import { taxFixture } from './tax-fixture.mjs';
import { buildLedger, createDataset, zipDataset, bookDate } from './tax-dataset.js';
import { captureStatements, decimalCents, sha256, recordVerifiedRefund } from './tax-evidence.js';
import { renderInvoice } from './tax-invoice.js';
import { bestellungenAlsCsv, handleBuchhaltung, jahrAusText } from './buchhaltung.js';

test('actual migrations support a snapshot, hashed files and cross-year cash events',async()=>{
  const {DB}=await taxFixture();const d=await createDataset({DB},2025);
  const ledger=JSON.parse(d.files['ledger.json']);
  assert.deepEqual(ledger.map(e=>[e.kind,e.amount_cents,e.book_date]),[
    ['capture',10000,'2026-01-01'],['fee',320,'2026-01-01'],['refund',2000,'2026-02-01']]);
  assert.equal(d.manifest.scope,'full_history');assert.equal(d.summary.orders,1);
  for(const f of d.manifest.files){assert.equal(await sha256(d.files[f.path]),f.sha256);assert.equal(new TextEncoder().encode(d.files[f.path]).length,f.bytes);}
  assert.equal(d.manifest.files.length,Object.keys(d.files).length-1);
  assert.equal(bookDate('2025-12-31T22:30:00Z'),'2025-12-31');
  const bytes=new Uint8Array(await zipDataset(d.files).arrayBuffer());
  assert.deepEqual([...bytes.slice(0,4)],[80,75,3,4]);
});
test('replayed capture has no duplicates; changed evidence and mutation fail',async()=>{
  const {DB,capture}=await taxFixture();
  await DB.batch(await captureStatements(DB,{id:'p1',commerce_order_id:'o1'},capture,'2026-03-01T00:00:00Z'));
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM tax_cash_events').get().n,3);
  await assert.rejects(()=>captureStatements(DB,{id:'p1',commerce_order_id:'o1'},{...capture,amount:{value:'99',currency_code:'EUR'}},'now'),/CONFLICTING/);
  assert.throws(()=>DB.raw.exec('UPDATE tax_cash_events SET amount_cents=1'),/immutable/);
  assert.throws(()=>DB.raw.exec('DELETE FROM tax_cash_events'),/retained/);
});
test('refund with unknown capture cannot manufacture an expense',async()=>{
  const {DB}=await taxFixture();
  await assert.rejects(()=>recordVerifiedRefund({DB},{resource:{id:'bad',status:'COMPLETED',amount:{value:'10',currency_code:'EUR'}}}),/REFERENCE_MISSING/);
});
test('legacy payments preserve gross amount but never invent a cash date',()=>{
  const tables={orders:[],order_items:[],payments:[{id:'p',order_id:'o',status:'REFUNDED',amount_cents:10000,currency:'EUR',updated_at:'2025-12-31'}],cash_events:[],refunds:[],invoices:[],rentals:[],payment_events:[],audit_events:[]};
  const {ledger,issues}=buildLedger(tables);
  assert.equal(ledger[0].amount_cents,10000);assert.equal(ledger[0].book_date,'');assert.ok(ledger[0].blocks.length);
  assert.ok(issues.some(i=>i.code==='MISSING_REFUND_EVIDENCE'));
  assert.ok(issues.some(i=>i.code==='PROVIDER_FEES_UNRECONCILED'));
});
test('a reservation before shipping is no sale and no missing evidence - after shipping it is flagged',()=>{
  const leer={order_items:[],cash_events:[],refunds:[],invoices:[],rentals:[],payment_events:[],audit_events:[]};
  const reserviert=buildLedger({...leer,orders:[{id:'o',status:'PAID'}],payments:[{id:'p',order_id:'o',status:'AUTHORIZED',amount_cents:1590,currency:'EUR'}]});
  assert.equal(reserviert.ledger.length,0);
  assert.ok(!reserviert.issues.some(i=>i.code==='ORDER_WITHOUT_PAYMENT_EVIDENCE'));
  const versendet=buildLedger({...leer,orders:[{id:'o',status:'SHIPPED'}],payments:[{id:'p',order_id:'o',status:'AUTHORIZED',amount_cents:1590,currency:'EUR'}]});
  assert.ok(versendet.issues.some(i=>i.code==='ORDER_WITHOUT_PAYMENT_EVIDENCE'));
});
test('multi-item CSV has a single order total and no false invoice label',()=>{
  const row={id:'o',order_number:'N',total_cents:10000,subtotal_cents:9500,shipping_cents:500,created_at:'2025-01-01'};
  const csv=bestellungenAlsCsv([{...row,article_no:'A'},{...row,article_no:'B'}]);
  assert.equal(csv.trim().split('\r\n').length,2);assert.match(csv,/A \/ B/);assert.doesNotMatch(csv,/Rechnungsnummer/);
});
test('strict years and decimal amounts do not accept partial input',()=>{
  for(const s of ['2025x','2025.0','2025/01'])assert.throws(()=>jahrAusText(s));
  for(const s of ['1,00','1e2','0.001','NaN','-1',''])assert.equal(decimalCents(s),null);
  assert.equal(decimalCents('123.45'),12345);
});
const order={order_number:'TEST-001',currency:'EUR',subtotal_cents:9000,shipping_cents:500,total_cents:9500,created_at:'2025-12-30',
 items:[{title_snapshot:'Testjacke',article_no:'A1',unit_price_cents:10000,quantity:1}],
 contact:{recipient_name:'Beispielkunde',address_line1:'Testweg 1',postal_code:'12345',city:'Teststadt',country_code:'DE'}};
const profile={mode:'small_business',confirmed:true,tax_number:'TEST-ONLY',seller:{name:'Musterhandel',street:'Beispielweg 2',city:'12345 Teststadt',country:'DE'}};
test('complete invoice includes issue date, parties, tax ID, discount and exemption',()=>{
  const invoice=renderInvoice(order,profile,'2026-01-02T12:00:00Z');
  assert.equal(invoice.ready,true);
  for(const text of ['02.01.2026','TEST-ONLY','Beispielkunde','Rabatt','§ 19 UStG','95,00'])assert.ok(invoice.html.includes(text),text);
});
test('unknown tax status never becomes a §19 invoice and malicious quantities are escaped',()=>{
  const invoice=renderInvoice({...order,items:[{...order.items[0],quantity:'<script>'}]},{...profile,confirmed:false});
  assert.equal(invoice.ready,false);assert.match(invoice.html,/ENTWURF/);
  assert.doesNotMatch(invoice.html,/<script>|§ 19 UStG/);
});
test('negative shipping and mismatched sums prevent invoice issuance',()=>{
  assert.equal(renderInvoice({...order,shipping_cents:-100,total_cents:8900},profile).ready,false);
  assert.equal(renderInvoice({...order,total_cents:1},profile).ready,false);
});
test('authenticated yearly route uses cash year and separate refund/fee totals',async()=>{
  const {DB}=await taxFixture();const origin='https://admin.disorder119.com';
  for(const year of [2025,2026]){
    const url=new URL('https://example.com/admin/buchhaltung/jahr/'+year);
    const res=await handleBuchhaltung(new Request(url,{headers:{Origin:origin,Authorization:'Bearer test'}}),{DB,ADMIN_TOKEN:'test'},url,'test',origin);
    assert.equal(res.status,200);const data=await res.json();
    assert.equal(data.einnahmenCents,year===2025?0:10000);assert.equal(data.saldoCents,year===2025?0:7680);
  }
});
