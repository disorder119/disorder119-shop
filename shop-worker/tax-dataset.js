// Private, versioned full-history export; no customer data is written to GitHub.
import { sha256 } from './tax-evidence.js';

export const DATASET_FORMAT='disorder119.shop-dataset';
const MAX_ROWS=10000;
export const QUERIES={
  orders:'SELECT id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,created_at,updated_at FROM commerce_orders ORDER BY id',
  order_items:'SELECT id,order_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency FROM order_items ORDER BY id',
  payments:'SELECT id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,created_at,updated_at FROM payments ORDER BY id',
  refunds:'SELECT id,order_id,rental_id,payment_id,provider_refund_id,amount_cents,currency,status,created_at,updated_at FROM refunds ORDER BY id',
  cash_events:'SELECT * FROM tax_cash_events ORDER BY id',
  invoices:'SELECT id,order_id,rechnungsnummer,ausgestellt_am,waehrung,warenwert_cents,versand_cents,gesamt_cents,html,text,pruefsumme,erstellt_am,document_type,html_sha256,tax_profile_json FROM rechnungen ORDER BY id',
  confirmations:'SELECT * FROM order_confirmation_archive ORDER BY order_id',
  rentals:'SELECT id,inventory_id,start_date,end_date,days,total_price_cents,currency,status,created_at,updated_at FROM rental_reservations ORDER BY id',
  rental_deposits:'SELECT id,rental_reservation_id,deposit_cents,status,created_at,updated_at FROM rentals ORDER BY id',
  returns:'SELECT id,order_id,rental_id,status,created_at,updated_at FROM returns ORDER BY id',
  payment_events:'SELECT id,provider,provider_event_id,event_type,payment_id,verified,received_at,processed_at,payload_hash FROM payment_events ORDER BY id',
  audit_events:"SELECT id,actor_type,entity_type,entity_id,event_type,request_id,created_at FROM audit_events WHERE entity_type IN ('payment','order','refund') ORDER BY id",
};
export function bookDate(timestamp) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
}
export function buildLedger(tables) {
  const issues=[];const ledger=[];const seen=new Set();
  const add=(event,source,blocks=[])=>{
    if (seen.has(event.id)) throw new Error('DUPLICATE_CASH_EVENT');seen.add(event.id);
    const order=tables.orders.find(o=>o.id===event.order_id);
    const paidAt=event.occurred_at||'';
    if (!paidAt) blocks.push('Tatsächlicher Zahlungszeitpunkt fehlt; Zahlungsanbieter-Abrechnung zuordnen.');
    if (!Number.isSafeInteger(event.amount_cents)||event.amount_cents<=0||event.currency!=='EUR') blocks.push('Betrag oder Währung nicht eindeutig.');
    ledger.push({id:event.id,kind:event.kind,order_id:event.order_id,payment_id:event.payment_id,provider:event.provider,provider_reference:event.provider_reference||'',amount_cents:event.amount_cents,currency:event.currency,occurred_at:paidAt,book_date:bookDate(paidAt),observed_at:event.observed_at||'',source,order_number:order?.order_number||'',article_numbers:tables.order_items.filter(i=>i.order_id===event.order_id).map(i=>i.article_no).filter(Boolean),blocks});
  };
  for(const e of tables.cash_events) add(e,'verified_provider_event');
  for(const p of tables.payments) {
    if (!['COMPLETED','REFUNDED','PARTIALLY_REFUNDED'].includes(p.status)) continue;
    if (!tables.cash_events.some(e=>e.kind==='capture'&&e.payment_id===p.id)) {
      const audit=tables.audit_events.find(e=>e.entity_id===p.id&&e.event_type==='PAYMENT_COMPLETED');
      add({id:`legacy:capture:${p.id}`,kind:'capture',order_id:p.order_id,payment_id:p.id,provider:p.provider,provider_reference:p.provider_payment_id,amount_cents:p.amount_cents,currency:p.currency,observed_at:audit?.created_at||p.updated_at||p.created_at},'legacy_payment_record');
    }
    if (!tables.cash_events.some(e=>e.kind==='fee'&&e.payment_id===p.id)) issues.push({code:'PROVIDER_FEES_UNRECONCILED',reference:p.id,message:'Zahlungsanbieter-Gebühren anhand der Abrechnung ergänzen; fehlende Gebühren sind nicht automatisch null.'});
    if (['REFUNDED','PARTIALLY_REFUNDED'].includes(p.status)&&!tables.cash_events.some(e=>e.kind==='refund'&&e.payment_id===p.id)&&!tables.refunds.some(r=>r.payment_id===p.id&&r.status==='COMPLETED')) issues.push({code:'MISSING_REFUND_EVIDENCE',reference:p.id,message:'Erstattungsstatus ohne passende belegte Erstattung.'});
  }
  for(const r of tables.refunds) {
    if (r.status!=='COMPLETED'||tables.cash_events.some(e=>e.kind==='refund'&&e.provider_reference===r.provider_refund_id))continue;
    add({id:`legacy:refund:${r.id}`,kind:'refund',order_id:r.order_id,payment_id:r.payment_id,provider:'',provider_reference:r.provider_refund_id,amount_cents:r.amount_cents,currency:r.currency,observed_at:r.updated_at||r.created_at},'legacy_refund_record');
  }
  for(const order of tables.orders) {
    // Vor dem Versand nur bei PayPal reserviert (eingezogen wird beim Versand):
    // noch kein Zufluss und auch kein fehlender Nachweis.
    const nurReserviert=['PAID','PREPARING'].includes(order.status)&&tables.payments.some(p=>p.order_id===order.id&&p.status==='AUTHORIZED');
    if (['PAID','PREPARING','SHIPPED','DELIVERED','RETURN_REQUESTED','RETURNED','REFUNDED'].includes(order.status)&&!nurReserviert&&!ledger.some(e=>e.kind==='capture'&&e.order_id===order.id)) issues.push({code:'ORDER_WITHOUT_PAYMENT_EVIDENCE',reference:order.id,message:'Bestellstatus ohne Zahlungsnachweis; kein Umsatz erfunden.'});
    if (ledger.some(e=>e.kind==='capture'&&e.order_id===order.id)&&!tables.invoices.some(i=>i.order_id===order.id&&i.document_type==='invoice'))issues.push({code:'INVOICE_REQUIRES_REVIEW',reference:order.id,message:'Keine geprüfte archivierte Rechnung für diesen Zahlungsvorgang.'});
  }
  if (tables.rentals.length)issues.push({code:'RENTALS_REQUIRE_RECONCILIATION',message:'Mietzahlungen und rückzahlbare Kautionen gesondert abstimmen; Mietstatus und Kautionsforderung sind keine Einnahmen.'});
  if (tables.payment_events.some(e=>e.verified&&(!e.processed_at||e.event_type.includes('REFUND'))))issues.push({code:'PROVIDER_EVENTS_RECONCILIATION',message:'Webhook-Verlauf mit Zahlungsanbieter-Abrechnung abstimmen, insbesondere historische Erstattungen.'});
  return {ledger,issues};
}
export async function createDataset(env,year) {
  const names=Object.keys(QUERIES);
  // D1 batch executes the read statements in one transaction/snapshot.
  const result=await env.DB.batch(names.map(name=>env.DB.prepare(QUERIES[name]+` LIMIT ${MAX_ROWS+1}`)));
  const tables={};names.forEach((name,i)=>{tables[name]=result[i]?.results||[];if(tables[name].length>MAX_ROWS)throw new Error('EXPORT_TOO_LARGE_USE_PARTITIONED_EXPORT');});
  const {ledger,issues}=buildLedger(tables);const files={};
  if(env.TAX_MODE!=='small_business'||env.TAX_CONFIRMED!=='true'||!String(env.TAX_NUMBER||'').trim())issues.push({code:'TAX_PROFILE_INCOMPLETE',message:'Rechnungskonfiguration fehlt oder Umsatzsteuerstatus ist ungeklärt. Bestätigten §19-Status und betriebliche Steuerkennung ergänzen. Andere Besteuerungsarten benötigen eine gesonderte Umsetzung.'});
  for(const event of tables.cash_events)if(await sha256(event.evidence_json)!==event.evidence_hash)throw new Error('PAYMENT_ARCHIVE_HASH_MISMATCH');
  if(JSON.stringify(tables).length>8*1024*1024)throw new Error('EXPORT_TOO_LARGE_USE_PARTITIONED_EXPORT');
  for (const name of names)files[`data/${name}.json`]=JSON.stringify(tables[name],null,2);
  files['ledger.json']=JSON.stringify(ledger,null,2);files['issues.json']=JSON.stringify(issues,null,2);
  for(const invoice of tables.invoices) {
    const slug=await sha256(invoice.id);files[`invoices/${slug}.html`]=invoice.html;files[`invoices/${slug}.txt`]=invoice.text;
    if (await sha256(invoice.text)!==invoice.pruefsumme || (invoice.html_sha256&&await sha256(invoice.html)!==invoice.html_sha256))throw new Error('INVOICE_ARCHIVE_HASH_MISMATCH');
  }
  for(const confirmation of tables.confirmations) {
    if(await sha256(confirmation.html)!==confirmation.html_sha256||await sha256(confirmation.text)!==confirmation.text_sha256)throw new Error('CONFIRMATION_ARCHIVE_HASH_MISMATCH');
  }
  files['README.txt']='Privater Shop-Datensatz, vollständig und unverändert aufbewahren. Kein Steuerbescheid und keine ELSTER-Übermittlung. Zahlungen, Gebühren und Erstattungen separat prüfen; Auszahlungen nicht erneut als Umsatz erfassen.';
  const manifest={format:DATASET_FORMAT,schema_version:1,source_id:'disorder119.com',scope:'full_history',requested_year:year,generated_at:new Date().toISOString(),timezone:'Europe/Berlin',files:[]};
  for(const [path,content]of Object.entries(files))manifest.files.push({path,sha256:await sha256(content),bytes:new TextEncoder().encode(content).length});
  files['manifest.json']=JSON.stringify(manifest,null,2);
  return {manifest,files,summary:{orders:tables.orders.length,invoices:tables.invoices.length,cash_events:ledger.length,issues:issues.length,review_required:true}};
}

// Small, dependency-free ZIP STORE writer. CRC-32 plus SHA-256 manifest.
export function zipDataset(files) {
  const encoder=new TextEncoder();let offset=0;const parts=[],central=[];
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  for(const [path,content]of Object.entries(files)) {
    const name=encoder.encode(path),data=encoder.encode(content),checksum=crc(data);
    const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,checksum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);
    const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,checksum,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);
    parts.push(local,data);central.push(dir);offset+=local.length+data.length;
    if(offset>16*1024*1024)throw new Error('EXPORT_TOO_LARGE_USE_PARTITIONED_EXPORT');
  }
  const directorySize=central.reduce((s,p)=>s+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
