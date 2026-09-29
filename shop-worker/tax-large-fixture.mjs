// Fully synthetic source DB including the actual production schema and triggers.
import {sqliteD1,allMigrations} from './test-d1.mjs';
import {formatOrderConfirmation} from './customer-mail.js';
import {sha256} from './tax-evidence.js';
export async function largeFixture(count){
 const DB=sqliteD1(allMigrations()),date='2025-11-15T12:00:00Z';
 const profile={mode:'small_business',confirmed:true,tax_number:'DEMO-NOT-VALID',seller:{name:'Musterhandel',street:'Musterweg 1',city:'12345 Musterstadt',country:'DE'}};
 const env={DB,TAX_MODE:'small_business',TAX_CONFIRMED:'true',TAX_NUMBER:'DEMO-NOT-VALID'};
 const insert=(table,keys)=>DB.raw.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`);
 const orders=insert('commerce_orders',['id','order_number','status','currency','subtotal_cents','shipping_cents','total_cents','idempotency_key','created_at']);
 const payments=insert('payments',['id','order_id','provider','provider_order_id','provider_payment_id','status','amount_cents','currency','idempotency_key','created_at']);
 const inventory=insert('inventory',['id','item_id','article_no','updated_at']);
 const items=insert('order_items',['id','order_id','inventory_id','item_id','article_no','title_snapshot','unit_price_cents','quantity','currency']);
 const invoices=insert('rechnungen',['id','order_id','rechnungsnummer','ausgestellt_am','waehrung','warenwert_cents','versand_cents','gesamt_cents','html','text','pruefsumme','erstellt_am','document_type','html_sha256','tax_profile_json']);
 const confirmations=insert('order_confirmation_archive',['order_id','subject','html','text','html_sha256','text_sha256','invoice_json','created_at']);
 const cash=insert('tax_cash_events',['id','payment_id','order_id','kind','provider','provider_reference','amount_cents','currency','occurred_at','observed_at','evidence_json','evidence_hash']);
 const totals={capture:0,fee:0,refund:0};let expectedEvents=0;
 DB.raw.exec('BEGIN');
 for(let n=0;n<count;n++){
  const id='DEMO-'+String(n).padStart(6,'0'),payment='pay-'+id,article='A-'+n,total=1000+n%100;
  orders.run(id,id,'PAID','EUR',total-100,100,total,id,date);
  payments.run(payment,id,'PAYPAL','provider-'+id,'capture-'+id,'COMPLETED',total,'EUR',payment,date);
  inventory.run('inv-'+id,n+1,article,date);items.run('item-'+id,id,'inv-'+id,n+1,article,'Musterjacke ä & '+n,total-100,1,'EUR');
  const order={id,order_number:id,created_at:date,currency:'EUR',subtotal_cents:total-100,shipping_cents:100,total_cents:total,items:[{article_no:article,title_snapshot:'Musterjacke ä & '+n,quantity:1,unit_price_cents:total-100}],contact:{recipient_name:'Musterkunde '+n,address_line1:'Beispielweg 1',postal_code:'12345',city:'Musterstadt',country_code:'DE'}};
  const message=formatOrderConfirmation(order,{taxProfile:profile,issuedAt:date}),invoice=message.invoice;
  if(!invoice.ready)throw new Error('INVALID_SYNTHETIC_INVOICE');
  invoices.run('invoice-'+id,id,id,date,'EUR',total-100,100,total,invoice.html,invoice.text,await sha256(invoice.text),date,'invoice',await sha256(invoice.html),JSON.stringify(profile));
  confirmations.run(id,message.subject,message.html,message.text,await sha256(message.html),await sha256(message.text),JSON.stringify(invoice),date);
  for(const [kind,amount]of [['capture',total],['fee',32],...(n%10===0?[['refund',100]]:[])]){
   const ref=kind+'-'+id,evidence=JSON.stringify({fixture:true,id:ref,amount_cents:amount});
   cash.run(ref,payment,id,kind,'PAYPAL',ref,amount,'EUR',date,date,evidence,await sha256(evidence));totals[kind]+=amount;expectedEvents++;
  }
 }
 DB.raw.exec('COMMIT');return{DB,env,totals,expectedEvents};
}
